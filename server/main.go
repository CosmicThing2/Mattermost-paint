package main

import (
	"github.com/mattermost/mattermost/server/public/plugin"
)

// pluginID must match the id field in plugin.json.
const pluginID = "com.cosmicthing.paint"

func main() {
	plugin.ClientMain(&Plugin{})
}
