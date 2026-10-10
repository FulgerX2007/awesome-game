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
	board, _ := leaderboard.New(10, "")
	srv := httptest.NewServer(newMux(board, saves.New("")))
	defer srv.Close()

	for _, path := range []string{"/", "/echo/", "/rust/", "/rust/core.js", "/oasis/", "/oasis/core.js"} {
		res, err := http.Get(srv.URL + path)
		if err != nil || res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s: %v %v", path, res.StatusCode, err)
		}
	}

	res, _ := http.Post(srv.URL+"/api/scores", "application/json", strings.NewReader(`{"name":"Ив","score":1200,"level":3}`))
	var out struct {
		Rank int                 `json:"rank"`
		Top  []leaderboard.Entry `json:"top"`
	}
	json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode != http.StatusOK || out.Rank != 1 || len(out.Top) != 1 {
		t.Fatalf("submit: status=%d out=%+v", res.StatusCode, out)
	}

	res, _ = http.Post(srv.URL+"/api/scores", "application/json", strings.NewReader(`{"name":"x","score":-5,"level":1}`))
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid score accepted: %d", res.StatusCode)
	}
}

func TestSavesAPI(t *testing.T) {
	board, _ := leaderboard.New(10, "")
	srv := httptest.NewServer(newMux(board, saves.New("")))
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
