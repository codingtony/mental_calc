package main

import (
	"slices"
	"testing"
)

func TestRankPlayers(t *testing.T) {
	in := []rankIn{
		{id: "crash-early", idx: 0, status: stCrashed, done: 3, ms: 9000, online: true},
		{id: "racing-6", idx: 1, status: stRacing, done: 6, ms: 7000, online: true},
		{id: "fin-slow", idx: 2, status: stFinished, done: 10, ms: 20000, online: true},
		{id: "crash-late", idx: 3, status: stCrashed, done: 3, ms: 12000, online: true},
		{id: "racing-6-fast", idx: 4, status: stRacing, done: 6, ms: 5000, online: false},
		{id: "fin-fast", idx: 5, status: stFinished, done: 10, ms: 15000, online: true},
		{id: "racing-6-tie", idx: 6, status: stRacing, done: 6, ms: 5000, online: true},
	}
	top, ranks := rankPlayers(in)
	order := make([]string, len(in))
	for id, r := range ranks {
		order[r.Rank-1] = id
		if r.Of != len(in) {
			t.Errorf("%s: of=%d", id, r.Of)
		}
	}
	want := []string{"fin-fast", "fin-slow", "racing-6-fast", "racing-6-tie", "racing-6", "crash-late", "crash-early"}
	if !slices.Equal(order, want) {
		t.Fatalf("order %v, want %v", order, want)
	}
	if len(top) != 5 || top[2].Status != stGone || ranks["racing-6-fast"].Status != stGone {
		t.Errorf("disconnected player must keep its rank and show as disconnected: %+v", top)
	}
}

func TestScenarioIsReplayable(t *testing.T) {
	s := suite(false)
	if len(s) != 60 {
		t.Fatalf("suite has %d scenarios, want 60", len(s))
	}
	seen := map[string]bool{}
	for _, a := range s {
		if a.slow {
			t.Fatalf("slow archetype %s in the default suite", a.name)
		}
		seen[a.name] = true
	}
	for _, a := range archetypes {
		if !a.slow && !seen[a.name] {
			t.Errorf("archetype %s missing from the suite", a.name)
		}
	}
	if got := suite(true)[0].name; got != "host_gone" {
		t.Errorf("suite(true)[0] = %s, want host_gone", got)
	}
	sc := &scenario{rng: scenarioRNG(7, 3)}
	s1 := sc.genScript(30, 3)
	sc.rng = scenarioRNG(7, 3)
	if s2 := sc.genScript(30, 3); !slices.Equal(s1, s2) {
		t.Fatal("genScript is not deterministic")
	}
	for _, s := range s1[:3] {
		if s.Status != stRacing {
			t.Fatalf("crash before minRacing: %v", s1)
		}
	}
}

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"  Al\x07i\x00ce  ": "Alice",
		"\x01\x02\x7f":      "",
		"Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀": "Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀Åsa😀",
	} {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%q) = %q, want %q", in, got, want)
		}
	}
}
