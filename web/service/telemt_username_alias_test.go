package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestBuildTelemtAliasMap(t *testing.T) {
	m := buildTelemtAliasMap([]model.ClientEntity{
		{Id: 1, Name: "fantasque"},
		{Id: 3, Name: "andrey alyukov"},
		{Id: 4, Name: "Денис"},
		{Id: 9, Name: "u4"}, // literal name equal to client 4's alias
	})
	if got := m["u3"]; got != "andrey alyukov" {
		t.Fatalf("u3 -> %q", got)
	}
	if _, ok := m["u4"]; ok {
		t.Fatal("alias colliding with a literal client name must be dropped")
	}
	if _, ok := m["fantasque"]; ok {
		t.Fatal("valid names need no alias")
	}
}

func TestClientNameCanon(t *testing.T) {
	for in, want := range map[string]string{"a b": "a_b", "  a   b\tc ": "a_b_c", "ok_name": "ok_name", "": ""} {
		if got := SuggestClientName(in); got != want {
			t.Fatalf("SuggestClientName(%q) = %q, want %q", in, got, want)
		}
	}
	if !ClientNameHasWhitespace("a b") || !ClientNameHasWhitespace(" a") || ClientNameHasWhitespace("a_b") {
		t.Fatal("whitespace detection is wrong")
	}
	if _, err := (&ClientService{}).AddClient(1, &model.ClientEntity{Name: "a b"}); err == nil {
		t.Fatal("AddClient must reject a name with spaces")
	}
}
