package main

import (
	"net/http"
	"path/filepath"
	"sync"

	"github.com/mattermost/mattermost/server/public/plugin"
)

// Plugin is the entry point for the server half of Paint.
//
// The server does three jobs: it hands out short-lived editor links for clients
// that cannot render plugin UI (the mobile apps), it serves the standalone
// editor page and its assets, and it performs the privileged work of reading the
// source image and publishing the edited copy.
type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration

	// bundlePath is the on-disk root of the installed plugin bundle, used to
	// serve the standalone editor's static assets.
	bundlePath string

	// staticHandler serves webapp/dist for the standalone editor page.
	staticHandler http.Handler

	// router is built once at activation.
	router *http.ServeMux
}

func (p *Plugin) OnActivate() error {
	bundlePath, err := p.API.GetBundlePath()
	if err != nil {
		return err
	}
	p.bundlePath = bundlePath
	p.staticHandler = http.StripPrefix(
		routeStatic,
		http.FileServer(http.Dir(filepath.Join(bundlePath, "webapp", "dist"))),
	)

	p.router = p.newRouter()

	if err := p.registerCommand(); err != nil {
		return err
	}

	return nil
}
