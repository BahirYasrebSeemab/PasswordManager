from app.security import hash_password, verify_password


def test_hash_password_returns_a_different_string_than_the_input():
    hashed = hash_password("correct horse battery staple")

    assert hashed != "correct horse battery staple"


def test_verify_password_succeeds_for_the_correct_password():
    hashed = hash_password("correct horse battery staple")

    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_password_fails_for_an_incorrect_password():
    hashed = hash_password("correct horse battery staple")

    assert verify_password("wrong password", hashed) is False


def test_hash_password_produces_a_unique_hash_each_time():
    hashed_a = hash_password("same password")
    hashed_b = hash_password("same password")

    assert hashed_a != hashed_b
