package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fulgerx2007/awesome-game/internal/leaderboard"
	"github.com/fulgerx2007/awesome-game/internal/saves"
)

func TestServer(t *testing.T) {
	srv := httptest.NewServer(newMux(memBoards(t), saves.New("")))
	defer srv.Close()

	for _, path := range []string{"/", "/echo/", "/rust/", "/rust/core.js", "/oasis/", "/oasis/core.js", "/valley/", "/valley/core.js", "/stars/", "/stars/core.js", "/deep/", "/deep/core.js", "/deep/models.js", "/deep/art/kraken.webp", "/math/", "/math/core.js", "/i18n.js", "/nav.js", "/fx.js", "/math/lang.js", "/ants/", "/ants/core.js", "/ants/sim.js", "/neon/", "/neon/core.js", "/neon/lang.js", "/wonders/", "/wonders/core.js", "/wonders/game.js", "/wonders/lang.js", "/bastion/", "/bastion/core.js", "/bastion/game.js", "/bastion/lang.js", "/village/", "/village/core.js", "/village/view.js", "/village/game.js", "/village/lang.js", "/village/audio.js", "/village/art.js", "/village/houses.js", "/village/sprites/sprites.json", "/village/sprites/grass.png", "/pins/", "/pins/core.js", "/pins/levels.js", "/pins/view.js", "/pins/game.js", "/pins/lang.js", "/pins/audio.js", "/rush/", "/rush/core.js", "/rush/view.js", "/rush/game.js", "/rush/lang.js", "/rush/audio.js", "/parking/", "/parking/core.js", "/parking/levels.js", "/parking/view.js", "/parking/game.js", "/parking/lang.js", "/parking/audio.js", "/sort/", "/sort/core.js", "/sort/levels.js", "/sort/view.js", "/sort/game.js", "/sort/lang.js", "/sort/audio.js", "/castle/", "/castle/core.js", "/castle/view.js", "/castle/game.js", "/castle/lang.js", "/castle/audio.js", "/winter/", "/winter/core.js", "/winter/view.js", "/winter/game.js", "/winter/lang.js", "/winter/audio.js", "/deep-godot/", "/deep-godot/index.pck", "/pins-godot/", "/pins-godot/index.pck", "/godot/engine.js", "/godot/engine.audio.worklet.js"} {
		res, err := http.Get(srv.URL + path)
		if err != nil || res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s: %v %v", path, res.StatusCode, err)
		}
		// read big files to the end: srv.Close waits for every response to be delivered
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
	}

	res, _ := http.Post(srv.URL+"/api/boards/echo/scores", "application/json", strings.NewReader(`{"name":"Ив","score":1200,"level":3}`))
	var out struct {
		Rank int                 `json:"rank"`
		Top  []leaderboard.Entry `json:"top"`
	}
	json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode != http.StatusOK || out.Rank != 1 || len(out.Top) != 1 {
		t.Fatalf("submit: status=%d out=%+v", res.StatusCode, out)
	}

	res, _ = http.Post(srv.URL+"/api/boards/echo/scores", "application/json", strings.NewReader(`{"name":"x","score":-5,"level":1}`))
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid score accepted: %d", res.StatusCode)
	}
}

func TestStaticRevalidates(t *testing.T) {
	srv := httptest.NewServer(newMux(memBoards(t), saves.New("")))
	defer srv.Close()

	for _, path := range []string{"/", "/deep/", "/deep/game.js"} {
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		tag := res.Header.Get("ETag")
		if res.Header.Get("Cache-Control") != "no-cache" || tag == "" {
			t.Fatalf("%s: Cache-Control=%q ETag=%q", path, res.Header.Get("Cache-Control"), tag)
		}
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		req.Header.Set("If-None-Match", tag)
		res, err = http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNotModified {
			t.Fatalf("%s: revalidation got %d, want 304", path, res.StatusCode)
		}
	}
}

// The Godot engine, shared by the Godot games, is embedded only as engine.wasm.gz and served under its own name.
func TestPrecompressedWasm(t *testing.T) {
	srv := httptest.NewServer(newMux(memBoards(t), saves.New("")))
	defer srv.Close()
	// a transport that leaves the encoding alone, like a browser's network log shows it
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/godot/engine.wasm", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	gz, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Encoding") != "gzip" || res.Header.Get("Content-Type") != "application/wasm" {
		t.Fatalf("gzip: status=%d encoding=%q type=%q", res.StatusCode, res.Header.Get("Content-Encoding"), res.Header.Get("Content-Type"))
	}
	if !strings.Contains(res.Header.Get("Vary"), "Accept-Encoding") || res.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("headers: %v", res.Header)
	}
	tag := res.Header.Get("ETag")
	req.Header.Set("If-None-Match", tag)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if tag == "" || res.StatusCode != http.StatusNotModified {
		t.Fatalf("revalidation: ETag=%q status=%d", tag, res.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodGet, srv.URL+"/godot/engine.wasm", nil)
	req.Header.Set("Accept-Encoding", "identity")
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.Header.Get("Content-Encoding") != "" || len(plain) <= len(gz) || string(plain[:4]) != "\x00asm" {
		t.Fatalf("plain: encoding=%q %d bytes (gzip %d)", res.Header.Get("Content-Encoding"), len(plain), len(gz))
	}
}

func TestSavesAPI(t *testing.T) {
	srv := httptest.NewServer(newMux(memBoards(t), saves.New("")))
	defer srv.Close()

	url := srv.URL + "/api/saves/abcdefgh23456789"
	if res, _ := http.Get(url); res.StatusCode != http.StatusNotFound {
		t.Fatalf("missing save: %d", res.StatusCode)
	}
	req, _ := http.NewRequest(http.MethodPut, url, strings.NewReader(`{"scrap":42}`))
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusNoContent {
		t.Fatalf("put: %d", res.StatusCode)
	}
	res, _ := http.Get(url)
	body, _ := io.ReadAll(res.Body)
	if string(body) != `{"scrap":42}` {
		t.Fatalf("get: %q", body)
	}
	req, _ = http.NewRequest(http.MethodPut, srv.URL+"/api/saves/BAD", strings.NewReader(`{}`))
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad code: %d", res.StatusCode)
	}
}

func memBoards(t *testing.T) map[string]*leaderboard.Board {
	t.Helper()
	b, err := newBoards(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestBoardsAreSeparate(t *testing.T) {
	srv := httptest.NewServer(newMux(memBoards(t), saves.New("")))
	defer srv.Close()

	http.Post(srv.URL+"/api/boards/valley/scores", "application/json", strings.NewReader(`{"name":"К","score":77,"level":5}`))
	var echo, valley []leaderboard.Entry
	res, _ := http.Get(srv.URL + "/api/boards/echo/scores")
	json.NewDecoder(res.Body).Decode(&echo)
	res, _ = http.Get(srv.URL + "/api/boards/valley/scores")
	json.NewDecoder(res.Body).Decode(&valley)
	if len(echo) != 0 || len(valley) != 1 || valley[0].Score != 77 {
		t.Fatalf("echo=%+v valley=%+v", echo, valley)
	}
	if res, _ := http.Get(srv.URL + "/api/boards/nope/scores"); res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown board: %d", res.StatusCode)
	}
}

// «Последняя крепость» posts its endless-mode scores to its own board.
func TestCastleBoard(t *testing.T) {
	srv := httptest.NewServer(newMux(memBoards(t), saves.New("")))
	defer srv.Close()

	res, err := http.Post(srv.URL+"/api/boards/castle/scores", "application/json", strings.NewReader(`{"name":"Лучник","score":2310,"level":17}`))
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("post: %v %v", err, res)
	}
	var got struct{ Rank int }
	json.NewDecoder(res.Body).Decode(&got)
	if got.Rank != 1 {
		t.Fatalf("rank = %d", got.Rank)
	}
	var list []leaderboard.Entry
	res, _ = http.Get(srv.URL + "/api/boards/castle/scores")
	json.NewDecoder(res.Body).Decode(&list)
	if len(list) != 1 || list[0].Name != "Лучник" || list[0].Score != 2310 || list[0].Level != 17 {
		t.Fatalf("castle board = %+v", list)
	}
	var bastion []leaderboard.Entry
	res, _ = http.Get(srv.URL + "/api/boards/bastion/scores")
	json.NewDecoder(res.Body).Decode(&bastion)
	if len(bastion) != 0 {
		t.Fatalf("the castle score leaked into bastion: %+v", bastion)
	}
}

func TestCheckWritable(t *testing.T) {
	dir := t.TempDir()
	if err := checkWritable(filepath.Join(dir, "nested")); err != nil {
		t.Fatalf("writable dir: %v", err)
	}
	if os.Getuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	ro := filepath.Join(dir, "ro")
	if err := os.Mkdir(ro, 0o555); err != nil {
		t.Fatal(err)
	}
	if err := checkWritable(ro); err == nil {
		t.Fatal("read-only dir reported as writable")
	}
}
