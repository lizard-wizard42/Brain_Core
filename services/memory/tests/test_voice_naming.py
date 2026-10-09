"""Naming a whole session voice group (synthetic data only)."""
import pytest

from services.memory.storage import database, identities
from services.memory.tests.test_voice_grouping import ToneEmbedder, _enroll, session  # noqa: F401
from services.memory.worker import voices


@pytest.fixture
def grouped(session):  # noqa: F811
    voices.assign_voices("s1", 0, ToneEmbedder())
    return session


def test_naming_a_voice_labels_every_turn_of_that_voice(grouped):
    ana = identities.create_identity("owner", "Ana")
    out = identities.set_voice_label("owner", "s1", 1, ana["id"])
    assert out["display_name"] == "Ana" and out["is_owner"] is False
    turns = database.compute_turns("s1")
    labelled = [t for t in turns if t.get("voice_label")]
    assert [t["voice"] for t in labelled] == ["speaker_1"] * 3
    assert all(t["voice_label"]["display_name"] == "Ana" for t in labelled)
    assert not any("voice_label" in t for t in turns if t.get("voice") == "speaker_0")


def test_owner_label_materializes_minha_voz_only_with_enrolled_voice(grouped):
    own = identities.owner_identity_id("owner")
    with pytest.raises(ValueError, match="identity not found"):
        identities.set_voice_label("owner", "s1", 0, own)
    _enroll(180)
    out = identities.set_voice_label("owner", "s1", 0, own)
    assert out["is_owner"] is True
    assert database.compute_turns("s1")[0]["voice_label"]["is_owner"] is True


def test_clear_label_and_rejections(grouped):
    ana = identities.create_identity("owner", "Ana")
    identities.set_voice_label("owner", "s1", 1, ana["id"])
    assert identities.set_voice_label("owner", "s1", 1, None)["identity_id"] is None
    assert not any("voice_label" in t for t in database.compute_turns("s1"))
    with pytest.raises(ValueError, match="voice not found"):
        identities.set_voice_label("owner", "s1", 9, ana["id"])
    with pytest.raises(ValueError, match="voice not found"):
        identities.set_voice_label("someone-else", "s1", 1, ana["id"])
    other = identities.create_identity("someone-else", "Bia")
    with pytest.raises(ValueError, match="voice not found"):
        identities.set_voice_label("someone-else", "s1", 1, other["id"])


def test_other_accounts_identity_is_refused(grouped):
    foreign = identities.create_identity("someone-else", "Bia")
    with pytest.raises(ValueError, match="identity not found"):
        identities.set_voice_label("owner", "s1", 1, foreign["id"])
