GO ?= go
NPM ?= npm
PLUGIN_ID := com.cosmicthing.paint
BUNDLE := dist/$(PLUGIN_ID).tar.gz

.PHONY: all server server-linux webapp package dist dist-linux check test clean deps

all: dist

## deps: install the webapp build toolchain
deps:
	cd webapp && $(NPM) install

## server: cross-compile the plugin binary for every supported platform
server:
	mkdir -p server/dist
	CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 $(GO) build -trimpath -o server/dist/plugin-linux-amd64 ./server
	CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 $(GO) build -trimpath -o server/dist/plugin-linux-arm64 ./server
	CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 $(GO) build -trimpath -o server/dist/plugin-darwin-amd64 ./server
	CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 $(GO) build -trimpath -o server/dist/plugin-darwin-arm64 ./server
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 $(GO) build -trimpath -o server/dist/plugin-windows-amd64.exe ./server

## server-linux: build for 64-bit Linux only, which is what most self-hosted
## servers run. Produces a bundle around a fifth the size of the full one.
server-linux:
	mkdir -p server/dist
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -o server/dist/plugin-linux-amd64 ./server

## webapp: build the plugin bundle and the standalone editor page
webapp:
	cd webapp && $(NPM) run build

## dist-linux: a slim bundle for a 64-bit Linux server
dist-linux: server-linux webapp package

## dist: assemble the installable plugin bundle for every platform
dist: server webapp package

package:
	rm -rf dist/$(PLUGIN_ID)
	mkdir -p dist/$(PLUGIN_ID)/server dist/$(PLUGIN_ID)/webapp
	cp plugin.json dist/$(PLUGIN_ID)/
	cp -r assets dist/$(PLUGIN_ID)/assets
	cp -r server/dist dist/$(PLUGIN_ID)/server/dist
	cp -r webapp/dist dist/$(PLUGIN_ID)/webapp/dist
	cd dist && tar -czf $(PLUGIN_ID).tar.gz $(PLUGIN_ID)
	@echo
	@echo "Built $(BUNDLE)"
	@echo "Upload it in System Console > Plugins > Plugin Management."

## check: vet the server and type-check the webapp
check:
	$(GO) vet ./server/...
	cd webapp && $(NPM) run check-types

## test: run the server test suite
test:
	$(GO) test ./server/...

clean:
	rm -rf dist server/dist webapp/dist
