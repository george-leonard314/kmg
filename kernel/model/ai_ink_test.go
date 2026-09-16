// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"strings"
	"testing"
)

func TestParseInkResult(t *testing.T) {
	cases := []struct {
		name, content, transcript, reply string
	}{
		{"json", `{"transcript": "entropy grows", "reply": "Why?"}`, "entropy grows", "Why?"},
		{"fenced", "```json\n{\"transcript\":\"a\",\"reply\":\"b\"}\n```", "a", "b"},
		{"plain", "Just an answer.", "", "Just an answer."},
		{"empty reply", `{"transcript": "a", "reply": ""}`, "", `{"transcript": "a", "reply": ""}`},
	}
	for _, c := range cases {
		got := parseInkResult(c.content)
		if got.Transcript != c.transcript || got.Reply != c.reply {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}
}

func TestCheckInkImages(t *testing.T) {
	if _, err := checkInkImages([]string{"http://example.com/a.png"}); err == nil {
		t.Error("a remote URL must be refused")
	}
	images, err := checkInkImages([]string{"", "data:image/png;base64,iVBORw0KGgo="})
	if err != nil || len(images) != 1 {
		t.Errorf("got %v, %v", images, err)
	}
}

func TestInkSystemPromptLanguage(t *testing.T) {
	messages := buildInkMessages(&InkRequest{Mode: InkModeReply}, nil, "SALUT")
	system := messages[0].Content
	for _, want := range []string{"standard English by default", "clearly Romanian", "clearly Dutch", "never from the language of your earlier replies", "diacritics"} {
		if !strings.Contains(system, want) {
			t.Errorf("system prompt lacks %q", want)
		}
	}
}
