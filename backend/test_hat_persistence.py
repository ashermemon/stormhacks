from backend import server


def test_hat_purchase_persists_hat_and_returns_hats(tmp_path):
    db_path = tmp_path / "hats.db"
    store = server.trinket_store.__class__(db_path)
    pid = "p1"
    store.db.execute(
        "INSERT OR REPLACE INTO trinket_wallet (player_id, shells) VALUES (?, ?)",
        (pid, 1000),
    )

    result = server.handle_hat_purchase(pid, "hat", store)

    assert result["ok"] is True
    assert store.get_hats(pid)["hat"] is True
    assert result["hats"]["hat"] is True


def test_welcome_payload_includes_hat_inventory(tmp_path):
    db_path = tmp_path / "welcome_hats.db"
    store = server.trinket_store.__class__(db_path)
    pid = "p2"
    store.add_hat(pid, "hat")

    payload = server.welcome_payload(pid, "Player", "token-123", store)

    assert payload["hats"]["hat"] is True
    assert payload["hats"]["wizardHat"] is True
