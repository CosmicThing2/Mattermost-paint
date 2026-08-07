package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

func samplePNG(t *testing.T) []byte {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.RGBA{R: 255, A: 255})

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("failed to encode png: %v", err)
	}

	return buf.Bytes()
}

func sampleJPEG(t *testing.T) []byte {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, 8, 8))

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("failed to encode jpeg: %v", err)
	}

	return buf.Bytes()
}

func dataURL(mimeType string, payload []byte) string {
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(payload)
}

func TestDecodeImagePayload(t *testing.T) {
	pngBytes := samplePNG(t)
	jpegBytes := sampleJPEG(t)

	t.Run("accepts png", func(t *testing.T) {
		data, ext, err := decodeImagePayload(dataURL("image/png", pngBytes), 1<<20)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ext != ".png" {
			t.Fatalf("got extension %q, want .png", ext)
		}
		if !bytes.Equal(data, pngBytes) {
			t.Fatal("decoded bytes did not round-trip")
		}
	})

	t.Run("accepts jpeg", func(t *testing.T) {
		_, ext, err := decodeImagePayload(dataURL("image/jpeg", jpegBytes), 1<<20)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ext != ".jpg" {
			t.Fatalf("got extension %q, want .jpg", ext)
		}
	})

	t.Run("rejects a payload that is not a data URL", func(t *testing.T) {
		if _, _, err := decodeImagePayload("https://example.com/x.png", 1<<20); err == nil {
			t.Fatal("expected an error for a non-data URL")
		}
	})

	t.Run("rejects a mislabelled payload", func(t *testing.T) {
		// The declared type says PNG; the bytes are not an image at all. The
		// server must believe the bytes, not the label.
		if _, _, err := decodeImagePayload(dataURL("image/png", []byte("<script>alert(1)</script>")), 1<<20); err == nil {
			t.Fatal("expected an error for a payload that is not really an image")
		}
	})

	t.Run("rejects an oversized payload", func(t *testing.T) {
		if _, _, err := decodeImagePayload(dataURL("image/png", pngBytes), 4); err == nil {
			t.Fatal("expected an error when the payload exceeds the limit")
		}
	})

	t.Run("rejects corrupt base64", func(t *testing.T) {
		if _, _, err := decodeImagePayload("data:image/png;base64,!!!!", 1<<20); err == nil {
			t.Fatal("expected an error for undecodable base64")
		}
	})
}

func TestAnnotatedName(t *testing.T) {
	cases := []struct {
		name     string
		original string
		ext      string
		want     string
	}{
		{"keeps the stem", "holiday.jpg", ".png", "holiday-annotated.png"},
		{"handles no extension", "photo", ".png", "photo-annotated.png"},
		{"strips a posix path", "a/b/c.png", ".png", "c-annotated.png"},
		{"strips a windows path", `C:\pics\snap.png`, ".jpg", "snap-annotated.jpg"},
		{"survives an empty name", "", ".png", "image-annotated.png"},
		{"survives a dotfile", ".gitignore", ".png", "image-annotated.png"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := annotatedName(testCase.original, testCase.ext); got != testCase.want {
				t.Fatalf("got %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestAnnotatedNameTruncatesLongNames(t *testing.T) {
	long := bytes.Repeat([]byte("a"), 300)

	got := annotatedName(string(long)+".png", ".png")
	if len(got) != 80+len("-annotated.png") {
		t.Fatalf("got a name of length %d, want %d", len(got), 80+len("-annotated.png"))
	}
}

func TestIsEditableImage(t *testing.T) {
	cases := []struct {
		name string
		info *model.FileInfo
		want bool
	}{
		{"png", &model.FileInfo{MimeType: "image/png", Width: 10, Height: 10}, true},
		{"jpeg with charset", &model.FileInfo{MimeType: "image/jpeg; charset=binary", Width: 10, Height: 10}, true},
		{"uppercase mime", &model.FileInfo{MimeType: "IMAGE/PNG", Width: 10, Height: 10}, true},
		{"svg is excluded", &model.FileInfo{MimeType: "image/svg+xml", Width: 10, Height: 10}, false},
		{"pdf", &model.FileInfo{MimeType: "application/pdf", Width: 10, Height: 10}, false},
		{"no dimensions", &model.FileInfo{MimeType: "image/png"}, false},
		{"deleted", &model.FileInfo{MimeType: "image/png", Width: 10, Height: 10, DeleteAt: 1}, false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isEditableImage(testCase.info); got != testCase.want {
				t.Fatalf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestConfigurationDefaults(t *testing.T) {
	got := (&configuration{}).withDefaults()

	if got.LinkExpiryMinutes != defaultLinkExpiryMinutes {
		t.Fatalf("got expiry %d, want %d", got.LinkExpiryMinutes, defaultLinkExpiryMinutes)
	}
	if got.MaxImageMB != defaultMaxImageMB {
		t.Fatalf("got max size %d, want %d", got.MaxImageMB, defaultMaxImageMB)
	}
	if got.SearchDepth != defaultSearchDepth {
		t.Fatalf("got depth %d, want %d", got.SearchDepth, defaultSearchDepth)
	}

	clamped := (&configuration{LinkExpiryMinutes: 99999, SearchDepth: 99999, MaxImageMB: -1}).withDefaults()
	if clamped.LinkExpiryMinutes != maxLinkExpiryMinutes {
		t.Fatalf("expiry was not clamped: %d", clamped.LinkExpiryMinutes)
	}
	if clamped.SearchDepth != maxSearchDepth {
		t.Fatalf("search depth was not clamped: %d", clamped.SearchDepth)
	}
	if clamped.MaxImageMB != defaultMaxImageMB {
		t.Fatalf("a negative size limit was not replaced: %d", clamped.MaxImageMB)
	}
}

func TestTokenFrom(t *testing.T) {
	newRequest := func(target string, header string) *http.Request {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		if header != "" {
			request.Header.Set(headerToken, header)
		}
		return request
	}

	cases := []struct {
		name   string
		target string
		header string
		want   string
	}{
		{"header wins", "/editor?paint_token=query", "fromheader", "fromheader"},
		{"named query parameter", "/editor?paint_token=abc", "", "abc"},
		{"legacy short parameter still works", "/editor?t=old", "", "old"},
		{"named parameter beats legacy", "/editor?t=old&paint_token=new", "", "new"},
		{"nothing at all", "/editor", "", ""},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := tokenFrom(newRequest(testCase.target, testCase.header)); got != testCase.want {
				t.Fatalf("got %q, want %q", got, testCase.want)
			}
		})
	}
}

// Regression test for signed-in browsers being unable to open /paint links.
//
// A browser already logged in to Mattermost sends both a session cookie and the
// token from the link. Treating the cookie as the whole answer discarded the
// token, and with it the only record of which file the link was for, so the page
// failed with "no file specified" — but only for people who happened to be
// logged in, which made it look like a browser quirk.
func TestMergeCaller(t *testing.T) {
	session := &editSession{UserID: "link-owner", FileID: "file-from-link"}

	t.Run("cookie and token together keep both", func(t *testing.T) {
		got := mergeCaller("signed-in-user", "tok", session)

		if got == nil {
			t.Fatal("expected a caller")
		}
		if got.UserID != "signed-in-user" {
			t.Fatalf("identity came from the token, not the session: %q", got.UserID)
		}
		if got.Session == nil {
			t.Fatal("the token's file binding was discarded")
		}
		if got.effectiveFileID("") != "file-from-link" {
			t.Fatalf("got file %q, want the one named by the link", got.effectiveFileID(""))
		}
	})

	t.Run("token alone acts as its owner", func(t *testing.T) {
		got := mergeCaller("", "tok", session)

		if got == nil || got.UserID != "link-owner" || got.Session == nil {
			t.Fatalf("got %+v, want the link owner", got)
		}
	})

	t.Run("cookie alone falls back to the requested file", func(t *testing.T) {
		got := mergeCaller("signed-in-user", "", nil)

		if got == nil || got.UserID != "signed-in-user" {
			t.Fatalf("got %+v, want the signed-in user", got)
		}
		if got.effectiveFileID("requested") != "requested" {
			t.Fatal("a signed-in caller should be able to name a file")
		}
	})

	t.Run("neither credential is not a caller", func(t *testing.T) {
		if got := mergeCaller("", "", nil); got != nil {
			t.Fatalf("got %+v, want nil", got)
		}
	})
}

// A caller holding a /paint token must not be able to point it at a different
// file by passing another id in the query string.
func TestCallerEffectiveFileID(t *testing.T) {
	tokenCaller := &caller{UserID: "u1", Session: &editSession{UserID: "u1", FileID: "locked"}}
	if got := tokenCaller.effectiveFileID("someone-elses-file"); got != "locked" {
		t.Fatalf("got %q, want the session's file id", got)
	}

	cookieCaller := &caller{UserID: "u1"}
	if got := cookieCaller.effectiveFileID("requested"); got != "requested" {
		t.Fatalf("got %q, want the requested file id", got)
	}
}
