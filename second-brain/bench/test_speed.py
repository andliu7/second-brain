"""Unit tests for speed.py's scoring helpers, against a tiny fake corpus in a temp dir.

    python -m pytest bench\\test_speed.py -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import speed  # noqa: E402


def make_corpus(tmp_path):
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "zephyr.md").write_text("Zephyr notes stay out of git.\nZephyr rule: read only.\n")
    (tmp_path / "notes" / "other.md").write_text("git is used everywhere. git git.\n")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "zephyr.js").write_text("zephyr zephyr zephyr\n")
    return tmp_path


def test_est_tokens_uses_3_6_chars_per_token():
    assert speed.est_tokens(36) == 10
    assert speed.est_tokens(0) == 0


def test_content_terms_drops_stopwords_short_words_and_duplicates():
    assert speed.content_terms("Why did I keep the Zephyr notes out of git, git?") == ["keep", "zephyr", "notes", "git"]


def test_pick_rarest_skips_zero_df_and_keeps_question_order_on_ties():
    terms = ["alpha", "beta", "gamma", "delta", "absent"]
    df = {"alpha": 9, "beta": 2, "gamma": 2, "delta": 1, "absent": 0}
    assert speed.pick_rarest(terms, df) == ["delta", "beta", "gamma"]


def test_rank_files_by_terms_matched_then_match_count():
    counts = {"a": {"x": 1, "y": 1}, "b": {"x": 50}, "c": {"y": 3, "x": 1}, "d": {"z": 9}}
    assert speed.rank_files(counts, ["x", "y"]) == ["c", "a", "b"]


def test_gold_rank_ignores_case_and_slash_direction():
    ranked = ["C:\\Proj\\A.md", "c:/proj/b.md"]
    assert speed.gold_rank(ranked, ["c:/proj/B.MD"]) == 2
    assert speed.gold_rank(ranked, ["c:/proj/z.md"]) is None


def test_chars_to_confirm_stops_at_gold_and_caps_at_five(tmp_path):
    files = []
    for i in range(7):
        p = tmp_path / f"f{i}.txt"
        p.write_text("x" * 10)
        files.append(str(p))
    assert speed.chars_to_confirm(files, 2) == 20
    assert speed.chars_to_confirm(files, None) == 50
    assert speed.chars_to_confirm(files, 7) == 50


def test_read_cost_caps_at_read_tool_line_limit(tmp_path):
    p = tmp_path / "long.txt"
    p.write_text("ab\n" * (speed.READ_LINE_CAP + 500))
    assert speed.read_cost(str(p)) == 3 * speed.READ_LINE_CAP


def test_brain_ranked_dedupes_winner_and_trace_runners_up():
    bundle = ("BRAIN C:/p/a.md#Head  [E 30/5]\nbody\n~trace 300ms 10 sections, keywords: x\n"
              "~    20.00 rare=0  C:/p/a.md#Other\n~    18.00 rare=1  C:/p/b.md#B > c\n")
    assert speed.brain_ranked(bundle) == ["C:/p/a.md", "C:/p/b.md"]


def test_pctl_nearest_rank():
    xs = list(range(1, 11))
    assert speed.pctl(xs, 0.5) == 5
    assert speed.pctl(xs, 0.9) == 9
    assert speed.pctl([], 0.9) is None


def test_grep_arm_on_fake_corpus_ranks_gold_first_and_skips_node_modules(tmp_path):
    root = make_corpus(tmp_path)
    gold = [str(root / "notes" / "zephyr.md")]
    res = speed.grep_arm(root, "Why are Zephyr notes kept out of git?", gold)
    assert res["rank"] == 1
    assert not any("node_modules" in p for p in res["top"])
    assert res["tokens"] > 0


def test_glob_arm_on_fake_corpus_matches_filenames(tmp_path):
    root = make_corpus(tmp_path)
    files, s = speed.rg_files(root)
    assert not any("node_modules" in f for f in files)
    res = speed.glob_arm(files, s, "where are my zephyr notes", [str(root / "notes" / "zephyr.md")])
    assert res["rank"] == 1
