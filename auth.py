'''
Passwords and sign-in sessions.
Passwords are never saved: only a random salt and a slow hash of the password with that salt.
Sessions are kept in memory, so stopping the server signs everyone out.
'''

import hashlib
import hmac
import re
import secrets
import threading
import time

HASH_ROUNDS = 600000
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128
SESSION_SECONDS = 12 * 60 * 60

USERNAME_PATTERN = re.compile(r'[a-z0-9_.-]{3,30}')

# The web server answers requests on several threads at once.
lock = threading.Lock()
sessions = {}   # token -> {'user_id', 'expires'}


class AuthError(Exception):
    '''
    Raised with a message for the user when a username or password is not accepted.
    '''


def check_username(username):
    '''
    Return the username in lower case, so Alex and alex are one account, otherwise raise AuthError.
    '''

    username = str(username).strip().lower()
    if not USERNAME_PATTERN.fullmatch(username):
        raise AuthError('Usernames are 3 to 30 letters, digits, dots, dashes or underscores.')
    return username


def check_new_password(password):
    '''
    Return if this password can be used for a new account, otherwise raise AuthError.
    '''

    if type(password) != str or not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        raise AuthError(f'Passwords must be {MIN_PASSWORD_LENGTH} to {MAX_PASSWORD_LENGTH} characters long.')


def hash_password(password, salt=None):
    '''
    Return (salt, hash) as text, making a new random salt unless one is given.
    '''

    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8', 'surrogatepass'),
                                 bytes.fromhex(salt), HASH_ROUNDS)
    return salt, digest.hex()


def check_password(password, salt, password_hash):
    '''
    Return True if the password matches the saved salt and hash.
    '''

    return hmac.compare_digest(hash_password(str(password), salt)[1], password_hash)


def create_session(user_id):
    '''
    Start a session for this user and return its secret token.
    '''

    token = secrets.token_urlsafe(32)
    with lock:
        sessions[token] = {'user_id': user_id, 'expires': time.time() + SESSION_SECONDS}
    return token


def get_session(token):
    '''
    Return the session for this token, or None if there is no live session.
    '''

    with lock:
        session = sessions.get(token)
        if session is not None and time.time() > session['expires']:
            del sessions[token]
            session = None
    return session


def end_session(token):
    '''
    Sign this session out.
    '''

    with lock:
        sessions.pop(token, None)
