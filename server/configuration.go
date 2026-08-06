package main

import (
	"reflect"

	"github.com/pkg/errors"
)

// configuration mirrors the settings_schema in plugin.json.
//
// It is treated as immutable once stored: OnConfigurationChange swaps in a whole
// new struct rather than mutating the live one, so readers never need a lock
// beyond the one guarding the pointer itself.
type configuration struct {
	EnablePreviewOverride bool
	LinkExpiryMinutes     int
	MaxImageMB            int
	SearchDepth           int
}

const (
	defaultLinkExpiryMinutes = 30
	defaultMaxImageMB        = 8
	defaultSearchDepth       = 100

	maxLinkExpiryMinutes = 24 * 60
	maxSearchDepth       = 1000
)

// withDefaults returns a copy with out-of-range or unset values replaced by
// sane ones. The System Console lets an admin type anything into a number
// field, including nothing at all, so every value gets clamped here rather
// than at each use site.
func (c *configuration) withDefaults() *configuration {
	out := *c

	if out.LinkExpiryMinutes <= 0 {
		out.LinkExpiryMinutes = defaultLinkExpiryMinutes
	}
	if out.LinkExpiryMinutes > maxLinkExpiryMinutes {
		out.LinkExpiryMinutes = maxLinkExpiryMinutes
	}
	if out.MaxImageMB <= 0 {
		out.MaxImageMB = defaultMaxImageMB
	}
	if out.SearchDepth <= 0 {
		out.SearchDepth = defaultSearchDepth
	}
	if out.SearchDepth > maxSearchDepth {
		out.SearchDepth = maxSearchDepth
	}

	return &out
}

func (c *configuration) maxImageBytes() int64 {
	return int64(c.MaxImageMB) * 1024 * 1024
}

// getConfiguration retrieves the active configuration under lock, never returning nil.
func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return (&configuration{}).withDefaults()
	}

	return p.configuration
}

// setConfiguration replaces the active configuration under lock.
func (p *Plugin) setConfiguration(configuration *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()

	if configuration != nil && p.configuration == configuration {
		// Reassigning the same pointer would let a caller mutate the live
		// configuration behind the backs of readers holding it.
		if reflect.ValueOf(*configuration).NumField() == 0 {
			return
		}

		panic("setConfiguration called with the existing configuration")
	}

	p.configuration = configuration
}

// OnConfigurationChange loads settings from the System Console.
func (p *Plugin) OnConfigurationChange() error {
	var configuration = new(configuration)

	if err := p.API.LoadPluginConfiguration(configuration); err != nil {
		return errors.Wrap(err, "failed to load plugin configuration")
	}

	p.setConfiguration(configuration.withDefaults())

	return nil
}
