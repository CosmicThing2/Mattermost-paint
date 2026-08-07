package main

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/pkg/errors"
)

const commandTrigger = "paint"

func (p *Plugin) registerCommand() error {
	err := p.API.RegisterCommand(&model.Command{
		Trigger:          commandTrigger,
		AutoComplete:     true,
		AutoCompleteDesc: "Annotate a photo from this channel and send the edited copy back",
		AutoCompleteHint: "[how many images back]",
		DisplayName:      "Paint",
		Description:      "Open the photo editor for a recent image in this channel.",
	})
	if err != nil {
		return errors.Wrap(err, "failed to register /paint command")
	}

	return nil
}

func (p *Plugin) ExecuteCommand(_ *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	text := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(args.Command), "/"+commandTrigger))

	if strings.EqualFold(text, "help") {
		return ephemeral(commandHelp()), nil
	}

	// `/paint` edits the most recent image; `/paint 2` the one before that, and
	// so on, which is the cheapest way to reach past an image without any UI to
	// tap on.
	nth := 1
	if text != "" {
		parsed, err := strconv.Atoi(text)
		if err != nil || parsed < 1 {
			return ephemeral(fmt.Sprintf("I didn't understand `%s`.\n\n%s", text, commandHelp())), nil
		}
		nth = parsed
	}

	if !p.API.HasPermissionToChannel(args.UserId, args.ChannelId, model.PermissionReadChannel) {
		return ephemeral("You don't have access to this channel."), nil
	}

	fileInfo, post, err := p.findNthRecentImage(args.ChannelId, nth)
	if err != nil {
		p.API.LogError("failed to search channel for images", "err", err.Error(), "channel_id", args.ChannelId)
		return ephemeral("Something went wrong looking for images in this channel."), nil
	}
	if fileInfo == nil {
		if nth == 1 {
			return ephemeral("I couldn't find any images in the last " +
				strconv.Itoa(p.getConfiguration().SearchDepth) + " messages here."), nil
		}
		return ephemeral(fmt.Sprintf(
			"I couldn't find %d images in the last %d messages here. Try a smaller number.",
			nth, p.getConfiguration().SearchDepth)), nil
	}

	link, err := p.buildEditorLink(args.UserId, fileInfo, post)
	if err != nil {
		p.API.LogError("failed to create editor link", "err", err.Error())
		return ephemeral("Something went wrong creating the editor link."), nil
	}

	return ephemeral(p.linkMessage(link, fileInfo, post)), nil
}

// buildEditorLink mints a one-user, one-file, expiring link to the editor.
func (p *Plugin) buildEditorLink(userID string, fileInfo *model.FileInfo, post *model.Post) (string, error) {
	siteURL := p.siteURL()
	if siteURL == "" {
		return "", errors.New("Site URL is not configured")
	}

	rootID := post.RootId
	if rootID == "" {
		rootID = post.Id
	}

	token, err := p.createEditSession(&editSession{
		UserID:    userID,
		FileID:    fileInfo.Id,
		PostID:    post.Id,
		ChannelID: post.ChannelId,
		RootID:    rootID,
	})
	if err != nil {
		return "", err
	}

	// The file id rides along as well as the token. If anything between here and
	// the browser strips the token — a privacy filter, a link rewriter, a chat
	// client trimming the URL — a signed-in browser can still open the right
	// image, because the channel permission check does not depend on the token.
	query := url.Values{
		"paint_token": {token},
		"file_id":     {fileInfo.Id},
	}

	return fmt.Sprintf("%s/plugins/%s%s?%s", siteURL, pluginID, routeEditor, query.Encode()), nil
}

func (p *Plugin) linkMessage(link string, fileInfo *model.FileInfo, post *model.Post) string {
	var who string
	if user, appErr := p.API.GetUser(post.UserId); appErr == nil {
		who = " shared by @" + user.Username
	}

	return fmt.Sprintf(
		"#### [Open the photo editor](%s)\n\n"+
			"Editing **%s**%s. Draw on it, then press **Send** and it'll be posted as a reply in that thread.\n\n"+
			"*Only you can open this link, and it expires in %d minutes. Wrong picture? Try `/paint 2` for the one before it.*",
		link, fileInfo.Name, who, p.getConfiguration().LinkExpiryMinutes,
	)
}

// findNthRecentImage walks back through the channel and returns the nth image it
// finds, newest first, along with the post carrying it.
func (p *Plugin) findNthRecentImage(channelID string, nth int) (*model.FileInfo, *model.Post, error) {
	depth := p.getConfiguration().SearchDepth

	postList, appErr := p.API.GetPostsForChannel(channelID, 0, depth)
	if appErr != nil {
		return nil, nil, appErr
	}

	seen := 0
	for _, postID := range postList.Order {
		post := postList.Posts[postID]
		if post == nil || post.DeleteAt != 0 || strings.HasPrefix(post.Type, "system_") {
			continue
		}

		for _, fileID := range post.FileIds {
			fileInfo, appErr := p.API.GetFileInfo(fileID)
			if appErr != nil || fileInfo == nil || !isEditableImage(fileInfo) {
				continue
			}

			seen++
			if seen == nth {
				return fileInfo, post, nil
			}
		}
	}

	return nil, nil, nil
}

// isEditableImage reports whether the editor can load and re-encode this file.
//
// SVG is excluded deliberately: drawing untrusted SVG onto a canvas is an XSS
// vector in the browser, and the result would be rasterised anyway.
func isEditableImage(fileInfo *model.FileInfo) bool {
	if fileInfo.DeleteAt != 0 {
		return false
	}
	if fileInfo.Width <= 0 || fileInfo.Height <= 0 {
		return false
	}

	mime := strings.ToLower(strings.TrimSpace(strings.SplitN(fileInfo.MimeType, ";", 2)[0]))
	switch mime {
	case "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp":
		return true
	default:
		return false
	}
}

func commandHelp() string {
	return "**Paint** — annotate a photo and send it back.\n\n" +
		"* `/paint` — edit the most recent image in this channel\n" +
		"* `/paint 3` — edit the third most recent image\n" +
		"* `/paint help` — this message\n\n" +
		"On the web and desktop apps you can skip the command entirely: open a photo and press the pencil button, " +
		"or use **Annotate image** in the attachment's ··· menu."
}

func ephemeral(text string) *model.CommandResponse {
	return &model.CommandResponse{
		ResponseType: model.CommandResponseTypeEphemeral,
		Text:         text,
	}
}

func (p *Plugin) siteURL() string {
	config := p.API.GetConfig()
	if config == nil || config.ServiceSettings.SiteURL == nil {
		return ""
	}

	return strings.TrimRight(*config.ServiceSettings.SiteURL, "/")
}
