"""Säkerhet per fält ur ollamas logprobs."""
import math

from app.utils.sakerhet import osakra_falt


def _tokens(delar):
    """[(text, sannolikhet, [alternativ...])] -> ollamas logprobs-format."""
    return [{"token": t, "logprob": math.log(p),
             "top_logprobs": [{"token": t, "logprob": math.log(p)}] + [{"token": a, "logprob": math.log(0.2)} for a in alt]}
            for t, p, alt in delar]


def test_osaker_siffra_far_andrahandsval():
    delar = [('{"gravsatta": [{"dods_ar": ', 1.0, []), ("197", 0.99, []), ("2", 0.64, ["5"]),
             (', "fornamn": "', 1.0, []), ("Anna", 0.5, ["Anne"]), ('"}]}', 1.0, [])]
    text = "".join(t for t, _, _ in delar)
    ut = osakra_falt(text, _tokens(delar))
    assert ut == {"gravsatta.0.dods_ar": {"sakerhet": 0.64, "kanske": "1975"}}  # text tas inte med


def test_saker_siffra_och_strangvarde():
    delar = [('{"utfardat_den": "', 1.0, []), ("1937-03-", 0.99, []), ("2", 0.7, ["1"]), ("3", 1.0, []),
             ('", "fod_nr": "', 1.0, []), ("7827", 0.99, []), ('"}', 1.0, [])]
    text = "".join(t for t, _, _ in delar)
    assert osakra_falt(text, _tokens(delar)) == {"utfardat_den": {"sakerhet": 0.7, "kanske": "1937-03-13"}}


def test_tokens_som_inte_stammer_ger_tomt():
    assert osakra_falt('{"dods_ar": 1972}', _tokens([("{", 0.5, [])])) == {}
    assert osakra_falt('{"dods_ar": 1972}', []) == {}
