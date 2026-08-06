package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"

	"github.com/pkg/errors"
)

const tokenKeyPrefix = "tok_"

// editSession is the state behind a /paint link.
//
// The mobile apps cannot render plugin UI, so mobile users open the editor in a
// browser instead. That browser may not carry a Mattermost session cookie, so
// the link carries an opaque bearer token that stands in for one. A token is
// deliberately narrow: it names a single user and a single file, it expires, and
// it is destroyed as soon as the edited image is published.
type editSession struct {
	UserID    string `json:"user_id"`
	FileID    string `json:"file_id"`
	PostID    string `json:"post_id"`
	ChannelID string `json:"channel_id"`
	RootID    string `json:"root_id"`
}

func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", errors.Wrap(err, "failed to read random bytes")
	}

	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// createEditSession stores a new session and returns its bearer token.
func (p *Plugin) createEditSession(session *editSession) (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}

	data, err := json.Marshal(session)
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal edit session")
	}

	ttl := int64(p.getConfiguration().LinkExpiryMinutes) * 60
	if appErr := p.API.KVSetWithExpiry(tokenKeyPrefix+token, data, ttl); appErr != nil {
		return "", errors.Wrap(appErr, "failed to store edit session")
	}

	return token, nil
}

// lookupEditSession resolves a bearer token. A missing or expired token is not
// an error worth distinguishing from a forged one, so both return nil.
func (p *Plugin) lookupEditSession(token string) *editSession {
	if token == "" {
		return nil
	}

	data, appErr := p.API.KVGet(tokenKeyPrefix + token)
	if appErr != nil || len(data) == 0 {
		return nil
	}

	var session editSession
	if err := json.Unmarshal(data, &session); err != nil {
		return nil
	}
	if session.UserID == "" || session.FileID == "" {
		return nil
	}

	return &session
}

func (p *Plugin) revokeEditSession(token string) {
	if token == "" {
		return
	}

	_ = p.API.KVDelete(tokenKeyPrefix + token)
}
