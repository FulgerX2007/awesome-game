package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fulgerx2007/awesome-game/internal/leaderboard"
	"github.com/fulgerx2007/awesome-game/internal/saves"
)

func TestServer(t *testing.T) {
	srv := httptest.NewServer(newMux(memBoards(t), saves.New("")))
	defer srv.Close()

	for _, path := range []string{"/", "/echo/", "/rust/", "/rust/core.js", "/oasis/", "/oasis/core.js", "/valley/", "/valley/core.js", "/stars/", "/stars/core.js", "/deep/", "/deep/core.js", "/math/", "/math/core.js", "/i18n.js", "/math/lang.js"} {
		res, err := http.Get(srv.URL + path)
		if err != nil || res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s: %v %v", path, res.StatusCode, err)
		}
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
