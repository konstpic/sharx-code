package service

import (
	"reflect"
	"testing"
)

func TestMergeOrder(t *testing.T) {
	cases := []struct {
		name               string
		current, req, want []int
	}{
		{"full reorder", []int{1, 2, 3, 4}, []int{3, 1, 4, 2}, []int{3, 1, 4, 2}},
		{"partial keeps the rest in order", []int{1, 2, 3, 4}, []int{4, 2}, []int{4, 2, 1, 3}},
		{"unknown and duplicate ids ignored", []int{1, 2, 3}, []int{9, 2, 2, 1}, []int{2, 1, 3}},
		{"empty request keeps order", []int{5, 6}, nil, []int{5, 6}},
	}
	for _, c := range cases {
		if got := mergeOrder(c.current, c.req); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
