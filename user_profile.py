'''
Users and their profiles.
Each user has one file, users/<id>.json, holding the profile, the learned tag weights and the check-in history.
The id is random and never changes. The username is how a user signs in, and is unique.
The file keeps a salt and a hash of the password, never the password itself.
The name is only what the app calls them, so two users can share one.
'''

import glob
import json
import os
import uuid

USERS_FOLDER = 'users'

# The tags used in events.json, so every interest can actually be matched.
INTERESTS = ['art', 'music', 'dance', 'film', 'food', 'games', 'sport', 'outdoor',
             'language', 'study', 'career', 'volunteering', 'party', 'wellness']

# Learned weights stay in this range so one rating cannot take over.
LEARNED_MIN = -3
LEARNED_MAX = 3
MAX_NAME_LENGTH = 40


def clean_name(name):
    '''
    Return the display name with spaces tidied, or an empty string if it cannot be used.
    '''

    name = ' '.join(str(name).split())
    if len(name) > MAX_NAME_LENGTH:
        return ''
    return name


def new_user_id():
    '''
    Return a new random user id, which is also a safe file name.
    '''

    return uuid.uuid4().hex


def new_user(username, salt, password_hash):
    '''
    Return a new user dictionary. It has no profile until the first profile form is saved.
    '''

    return {
        'id': new_user_id(),
        'username': username,
        'salt': salt,
        'password_hash': password_hash,
        'name': username,
        'personality': None,
        'interests': [],
        'setting': None,
        'atmosphere': None,
        'learned': {},
        'ratings': {},
        'checkins': [],
    }


def user_path(user_id):
    '''
    Return the path of the file that belongs to this user.
    '''

    return os.path.join(USERS_FOLDER, f'{user_id}.json')


def load_user(user_id):
    '''
    Return the saved user dictionary, or None if there is no such user.
    '''

    path = user_path(user_id)
    if not os.path.exists(path):
        return None
    with open(path) as file:
        user = json.load(file)
    return user


def find_user(username):
    '''
    Return the user with this username, or None if there is none.
    Files from before passwords have no username, so they can never match.
    '''

    for path in glob.glob(user_path('*')):
        with open(path) as file:
            user = json.load(file)
        if user.get('username') == username:
            return user
    return None


def save_user(user):
    '''
    Write the user dictionary to the user's own file.
    '''

    if not os.path.exists(USERS_FOLDER):
        os.mkdir(USERS_FOLDER)
    with open(user_path(user['id']), 'w') as file:
        json.dump(user, file, indent=2)


def add_checkin(user, checkin):
    '''
    Add today's scores to the user's history (free days are not kept).
    '''

    record = {}
    for key in ['date', 'stress', 'mood', 'belonging', 'energy', 'confidence']:
        record[key] = checkin[key]
    user['checkins'].append(record)


def update_learned(user, event, rating):
    '''
    Update the learned weight of every tag of the event from a 1-3 rating.
    3 adds one point, 1 takes one point away, 2 changes nothing.
    The rating is also saved, so the event is not recommended or asked about again.
    '''

    user['ratings'][event['name']] = rating

    if rating == 3:
        change = 1
    elif rating == 1:
        change = -1
    else:
        return

    for tag in event['tags']:
        value = user['learned'].get(tag, 0) + change
        # Keep every weight between LEARNED_MIN and LEARNED_MAX.
        value = max(LEARNED_MIN, min(LEARNED_MAX, value))
        user['learned'][tag] = value
