package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"path"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/pkg/errors"
)

const (
	routeEditor   = "/editor"
	routeStatic   = "/static/"
	routeSettings = "/api/v1/settings"
	routeContext  = "/api/v1/context"
	routeImage    = "/api/v1/image"
	routePublish  = "/api/v1/publish"

	headerUserID = "Mattermost-User-Id"
	headerToken  = "X-Paint-Token"
)

func (p *Plugin) newRouter() *http.ServeMux {
	router := http.NewServeMux()
	router.HandleFunc(routeEditor, p.handleEditorPage)
	router.HandleFunc(routeSettings, p.handleSettings)
	router.HandleFunc(routeContext, p.handleContext)
	router.HandleFunc(routeImage, p.handleImage)
	router.HandleFunc(routePublish, p.handlePublish)
	router.Handle(routeStatic, p.staticHandler)

	return router
}

func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	p.router.ServeHTTP(w, r)
}

// caller is an authenticated requester, arriving either with a Mattermost
// session cookie (web and desktop) or with a /paint bearer token (mobile).
type caller struct {
	UserID  string
	Token   string
	Session *editSession
}

// resolveCaller authenticates a request.
func (p *Plugin) resolveCaller(r *http.Request) *caller {
	token := tokenFrom(r)

	return mergeCaller(r.Header.Get(headerUserID), token, p.lookupEditSession(token))
}

// tokenFrom pulls the bearer token out of a request.
//
// The query parameter is spelled out rather than shortened. Privacy-focused
// browsers strip short, tracker-shaped parameters from URLs, and a token called
// `t` looks exactly like the ones they are built to remove.
func tokenFrom(r *http.Request) string {
	if token := r.Header.Get(headerToken); token != "" {
		return token
	}

	query := r.URL.Query()
	if token := query.Get("paint_token"); token != "" {
		return token
	}

	// Links handed out by older versions of the plugin.
	return query.Get("t")
}

// mergeCaller decides who is asking and, when a /paint link is involved, which
// file they are allowed to ask about.
//
// These are two separate questions and they need two separate answers. A
// Mattermost session cookie always wins on *identity*, so opening someone
// else's leaked link in a logged-in browser acts as you, not as them, and the
// channel permission check that follows is done against you. But the token is
// the only thing that records *which file* the link was for, so it is kept even
// when a cookie is present — dropping it there is what left a signed-in browser
// staring at "no file specified" while a signed-out one worked fine.
func mergeCaller(sessionUserID, token string, session *editSession) *caller {
	if sessionUserID != "" {
		return &caller{UserID: sessionUserID, Token: token, Session: session}
	}

	if session != nil {
		return &caller{UserID: session.UserID, Token: token, Session: session}
	}

	return nil
}

// authorizeFile resolves a file the caller is allowed to read.
//
// Every entry point funnels through here: a token narrows the caller to exactly
// one file, and channel membership is re-checked on each request rather than
// trusted from whenever the link was minted.
func (p *Plugin) authorizeFile(c *caller, fileID string) (*model.FileInfo, *model.Post, error) {
	if fileID == "" {
		return nil, nil, errors.New("no file specified")
	}
	if c.Session != nil && c.Session.FileID != fileID {
		return nil, nil, errors.New("this link is for a different image")
	}

	fileInfo, appErr := p.API.GetFileInfo(fileID)
	if appErr != nil || fileInfo == nil {
		return nil, nil, errors.New("image not found")
	}
	if !isEditableImage(fileInfo) {
		return nil, nil, errors.New("that file isn't an image Paint can edit")
	}

	if fileInfo.PostId == "" {
		// A file that was uploaded but never posted is only visible to whoever
		// uploaded it.
		if fileInfo.CreatorId != c.UserID {
			return nil, nil, errors.New("image not found")
		}
		return fileInfo, nil, nil
	}

	post, appErr := p.API.GetPost(fileInfo.PostId)
	if appErr != nil || post == nil || post.DeleteAt != 0 {
		return nil, nil, errors.New("image not found")
	}
	if !p.API.HasPermissionToChannel(c.UserID, post.ChannelId, model.PermissionReadChannel) {
		return nil, nil, errors.New("image not found")
	}

	return fileInfo, post, nil
}

// -- editor page --------------------------------------------------------------

type bootstrap struct {
	PluginBase string `json:"pluginBase"`
	Standalone bool   `json:"standalone"`
}

// handleEditorPage serves the standalone editor shell.
//
// It carries no data and does no authentication, because it cannot: the token
// is in the URL fragment, which the browser never sends. The page is an empty
// frame that reads the fragment in JavaScript and authenticates from there, so
// every request that actually touches an image is still checked — see
// handleContext, handleImage and handlePublish. Serving the frame to an
// anonymous request discloses nothing beyond the fact that the plugin exists.
func (p *Plugin) handleEditorPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	nonce, err := randomNonce()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	data, err := json.Marshal(bootstrap{
		PluginBase: "/plugins/" + pluginID,
		Standalone: true,
	})
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.Header().Set("Content-Security-Policy", strings.Join([]string{
		"default-src 'none'",
		"img-src 'self' data: blob:",
		"script-src 'self' 'nonce-" + nonce + "'",
		"style-src 'self' 'unsafe-inline'",
		"connect-src 'self'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	}, "; "))

	if err := editorPageTemplate.Execute(w, map[string]any{
		"Nonce":     nonce,
		"Bootstrap": string(data),
		"Script":    "/plugins/" + pluginID + routeStatic + "standalone.js",
	}); err != nil {
		p.API.LogError("failed to render editor page", "err", err.Error())
	}
}

func (c *caller) effectiveFileID(queryFileID string) string {
	if c.Session != nil {
		return c.Session.FileID
	}

	return queryFileID
}

var editorPageTemplate = template.Must(template.New("editor").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>Paint</title>
</head>
<body>
<div id="paint-root" data-bootstrap="{{.Bootstrap}}"></div>
<script nonce="{{.Nonce}}" src="{{.Script}}" defer></script>
</body>
</html>
`))

// -- json api -----------------------------------------------------------------

type contextResponse struct {
	FileID      string `json:"file_id"`
	FileName    string `json:"file_name"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	MimeType    string `json:"mime_type"`
	PostID      string `json:"post_id"`
	RootID      string `json:"root_id"`
	ChannelID   string `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	AuthorName  string `json:"author_name"`
	CanPost     bool   `json:"can_post"`
	MaxBytes    int64  `json:"max_bytes"`
}

// handleSettings exposes the handful of settings the webapp needs to decide
// what to register. Ordinary users cannot read plugin configuration through the
// System Console API, so it is served here rather than pulled from the store.
func (p *Plugin) handleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if r.Header.Get(headerUserID) == "" {
		writeJSONError(w, http.StatusUnauthorized, "This editor link has expired, or you are not signed in to Mattermost. Run /paint again to get a new link.")
		return
	}

	config := p.getConfiguration()
	writeJSON(w, http.StatusOK, map[string]any{
		"preview_override": config.EnablePreviewOverride,
		"max_bytes":        config.maxImageBytes(),
	})
}

func (p *Plugin) handleContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	c := p.resolveCaller(r)
	if c == nil {
		writeJSONError(w, http.StatusUnauthorized, "This editor link has expired, or you are not signed in to Mattermost. Run /paint again to get a new link.")
		return
	}

	fileID := c.effectiveFileID(r.URL.Query().Get("file_id"))
	fileInfo, post, err := p.authorizeFile(c, fileID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}

	response := contextResponse{
		FileID:   fileInfo.Id,
		FileName: fileInfo.Name,
		Width:    fileInfo.Width,
		Height:   fileInfo.Height,
		MimeType: fileInfo.MimeType,
		MaxBytes: p.getConfiguration().maxImageBytes(),
	}

	if post != nil {
		response.PostID = post.Id
		response.ChannelID = post.ChannelId
		response.RootID = post.RootId
		if response.RootID == "" {
			response.RootID = post.Id
		}
		response.CanPost = p.API.HasPermissionToChannel(c.UserID, post.ChannelId, model.PermissionCreatePost)

		if channel, appErr := p.API.GetChannel(post.ChannelId); appErr == nil {
			response.ChannelName = channel.DisplayName
		}
		if author, appErr := p.API.GetUser(post.UserId); appErr == nil {
			response.AuthorName = author.Username
		}
	}

	writeJSON(w, http.StatusOK, response)
}

func (p *Plugin) handleImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	c := p.resolveCaller(r)
	if c == nil {
		writeJSONError(w, http.StatusUnauthorized, "This editor link has expired, or you are not signed in to Mattermost. Run /paint again to get a new link.")
		return
	}

	fileID := c.effectiveFileID(r.URL.Query().Get("file_id"))
	fileInfo, _, err := p.authorizeFile(c, fileID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}

	data, appErr := p.API.GetFile(fileInfo.Id)
	if appErr != nil {
		p.API.LogError("failed to read file", "err", appErr.Error(), "file_id", fileInfo.Id)
		writeJSONError(w, http.StatusInternalServerError, "couldn't read that image")
		return
	}

	w.Header().Set("Content-Type", fileInfo.MimeType)
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Content-Disposition", "inline")
	_, _ = w.Write(data)
}

type publishRequest struct {
	FileID  string `json:"file_id"`
	Image   string `json:"image"`
	Message string `json:"message"`
}

type publishResponse struct {
	PostID string `json:"post_id"`
}

func (p *Plugin) handlePublish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	c := p.resolveCaller(r)
	if c == nil {
		writeJSONError(w, http.StatusUnauthorized, "This editor link has expired, or you are not signed in to Mattermost. Run /paint again to get a new link.")
		return
	}
	// Required unconditionally. A caller can now hold both a cookie and a token
	// at once, and making this depend on which credential was used would mean a
	// token in the URL could waive the CSRF guard on a cookie-authenticated
	// write. The editor always sends the header, so there is nothing to lose.
	if r.Header.Get("X-Requested-With") != "XMLHttpRequest" {
		writeJSONError(w, http.StatusForbidden, "missing X-Requested-With header")
		return
	}

	config := p.getConfiguration()
	// base64 costs a third on top of the raw bytes; the rest is slack for JSON.
	r.Body = http.MaxBytesReader(w, r.Body, config.maxImageBytes()*2)

	var request publishRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSONError(w, http.StatusBadRequest, "That edit was too large to send.")
		return
	}

	fileID := c.effectiveFileID(request.FileID)
	fileInfo, post, err := p.authorizeFile(c, fileID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, err.Error())
		return
	}
	if post == nil {
		writeJSONError(w, http.StatusBadRequest, "That image isn't attached to a message yet.")
		return
	}
	if !p.API.HasPermissionToChannel(c.UserID, post.ChannelId, model.PermissionCreatePost) {
		writeJSONError(w, http.StatusForbidden, "You can't post in that channel.")
		return
	}

	data, ext, err := decodeImagePayload(request.Image, config.maxImageBytes())
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	uploaded, appErr := p.API.UploadFile(data, post.ChannelId, annotatedName(fileInfo.Name, ext))
	if appErr != nil {
		p.API.LogError("failed to upload annotated image", "err", appErr.Error())
		writeJSONError(w, http.StatusInternalServerError, "Mattermost wouldn't accept the edited image.")
		return
	}

	rootID := post.RootId
	if rootID == "" {
		rootID = post.Id
	}

	created, appErr := p.API.CreatePost(&model.Post{
		UserId:    c.UserID,
		ChannelId: post.ChannelId,
		RootId:    rootID,
		Message:   strings.TrimSpace(request.Message),
		FileIds:   []string{uploaded.Id},
	})
	if appErr != nil {
		p.API.LogError("failed to create annotated post", "err", appErr.Error())
		writeJSONError(w, http.StatusInternalServerError, "Mattermost wouldn't accept the reply.")
		return
	}

	// The link has done its job; burn it so a copied URL isn't reusable.
	p.revokeEditSession(c.Token)

	writeJSON(w, http.StatusOK, publishResponse{PostID: created.Id})
}

// decodeImagePayload turns the canvas data URL back into bytes, and insists the
// result really is a PNG or JPEG rather than trusting the declared type.
func decodeImagePayload(payload string, maxBytes int64) ([]byte, string, error) {
	const marker = ";base64,"

	index := strings.Index(payload, marker)
	if !strings.HasPrefix(payload, "data:image/") || index < 0 {
		return nil, "", errors.New("that wasn't an image")
	}

	data, err := base64.StdEncoding.DecodeString(payload[index+len(marker):])
	if err != nil {
		return nil, "", errors.New("that image was corrupted in transit")
	}
	if int64(len(data)) > maxBytes {
		return nil, "", fmt.Errorf("that edit is larger than the %d MB limit", maxBytes/(1024*1024))
	}

	_, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", errors.New("that wasn't a readable image")
	}
	switch format {
	case "png":
		return data, ".png", nil
	case "jpeg":
		return data, ".jpg", nil
	default:
		return nil, "", errors.New("only PNG and JPEG edits can be sent")
	}
}

// annotatedName keeps the original name recognisable in the channel while making
// clear which copy is which.
func annotatedName(original, ext string) string {
	base := path.Base(strings.ReplaceAll(original, "\\", "/"))
	base = strings.TrimSuffix(base, path.Ext(base))
	base = strings.TrimSpace(strings.Trim(base, "."))

	if base == "" {
		base = "image"
	}
	if len(base) > 80 {
		base = base[:80]
	}

	return base + "-annotated" + ext
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// randomNonce is kept separate from randomToken so a future change to token
// length cannot silently weaken CSP nonces.
func randomNonce() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", errors.Wrap(err, "failed to read random bytes")
	}

	return base64.RawURLEncoding.EncodeToString(buf), nil
}
