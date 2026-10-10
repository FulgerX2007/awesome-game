package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fulgerx2007/awesome-game/internal/leaderboard"
)

func TestServer(t *testing.T) {
	board, _ := leaderboard.New(10, "")
	srv := httptest.NewServer(newMux(board))
	defer srv.Close()

	res, err := http.Get(srv.URL + "/")
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("index: %v %v", res.StatusCode, err)
	}

	res, _ = http.Post(srv.URL+"/api/scores", "application/json", strings.NewReader(`{"name":"Ив","score":1200,"level":3}`))
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
