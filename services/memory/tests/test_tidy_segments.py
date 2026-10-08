"""Synthetic checks for transcript fragment tidying (no audio, no model)."""
from services.memory.worker.transcriber import TranscribedSegment as S, tidy_segments


def texts(segs):
    return [s.text for s in segs]


def test_punctuation_only_fragment_is_attached_not_kept_alone():
    out = tidy_segments([S(0, 3000, "Olá, tudo bem"), S(3000, 3200, "."), S(9000, 12000, "Tudo ótimo.")])
    assert texts(out) == ["Olá, tudo bem.", "Tudo ótimo."]
    assert out[0].end_ms == 3200


def test_leading_punctuation_is_dropped():
    assert texts(tidy_segments([S(0, 200, "..."), S(500, 3500, "Começando agora.")])) == ["Começando agora."]


def test_lone_letter_fragment_is_merged_into_neighbour_without_losing_text():
    out = tidy_segments([S(0, 3000, "Eu fui ver"), S(3100, 3400, "o"), S(3500, 6000, "filme ontem.")])
    assert texts(out) == ["Eu fui ver o filme ontem."]
    assert (out[0].start_ms, out[0].end_ms) == (0, 6000)


def test_sentence_end_with_long_pause_starts_a_new_segment():
    out = tidy_segments([S(0, 4000, "Foi isso que aconteceu."), S(6000, 10000, "E depois ninguém falou.")])
    assert len(out) == 2


def test_complete_sentences_with_small_gap_stay_separate_unless_short():
    long_a, long_b = S(0, 4000, "Primeira frase completa."), S(4200, 8000, "Segunda frase completa.")
    assert len(tidy_segments([long_a, long_b])) == 2
    assert len(tidy_segments([S(0, 900, "Sim."), S(1000, 4000, "Eu concordo com isso.")])) == 1


def test_merge_respects_maximum_duration():
    segs = [S(i * 8000, i * 8000 + 7900, "continua sem ponto") for i in range(5)]
    out = tidy_segments(segs, max_ms=20000)
    assert all(s.end_ms - s.start_ms <= 20000 for s in out) and len(out) > 1


def test_empty_and_blank_inputs():
    assert tidy_segments([]) == []
    assert tidy_segments([S(0, 100, "  ")]) == []
