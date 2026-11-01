'''
Web version of the Campus Wellbeing Recommender.
Runs a small server on this computer and opens the app in the browser.
Scoring, saving and recommending are done by the other modules;
this file passes answers between the page (web/) and those modules.
This is the main script: run it to start the program.
Run with: python3 web_app.py
'''

import datetime
import json
import os
import threading
import webbrowser
from http.cookies import SimpleCookie, CookieError
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

from questions import (PSS4_QUESTIONS, WHO5_QUESTIONS, UCLA3_QUESTIONS, DAYS,
                       score_pss4, score_who5, score_ucla3, today_size,
                       overall_state, focus_area, needs_support)
from user_profile import (INTERESTS, MAX_NAME_LENGTH, clean_name, new_user,
                          load_user, find_user, save_user, add_checkin, update_learned)
from recommender import load_events, recommend
from auth import (AuthError, SESSION_SECONDS, check_username, check_new_password, hash_password,
                  check_password, create_session, get_session, end_session)

PORT = 8001
SESSION_COOKIE = 'session'
SUPPORT_LINK = 'https://sydney.edu.au/students/counselling-and-mental-health-support.html'

FOCUS_TEXT = {
    'stress': 'stress is your biggest load right now.',
    'mood': 'your mood is the area to look after first.',
    'belonging': 'feeling isolated is your main concern today.',
    'confidence': 'your confidence could use a boost.',
    'none': 'nothing stands out today, keep doing what works for you.',
}
HERE = os.path.dirname(os.path.abspath(__file__))
WEB_FOLDER = os.path.join(HERE, 'web')

# Answer options as [value, words], in the order the scales list them.
PSS4_CHOICES = [[0, 'Never'], [1, 'Almost never'], [2, 'Sometimes'],
                [3, 'Fairly often'], [4, 'Very often']]
WHO5_CHOICES = [[5, 'All of the time'], [4, 'Most of the time'],
                [3, 'More than half of the time'], [2, 'Less than half of the time'],
                [1, 'Some of the time'], [0, 'At no time']]
UCLA3_CHOICES = [[1, 'Hardly ever'], [2, 'Some of the time'], [3, 'Often']]

PERSONALITIES = ['introvert', 'ambivert', 'extrovert']
SETTINGS = ['indoor', 'outdoor', 'either']
ATMOSPHERES = ['quiet', 'active', 'either']

# For each score: is a lower number the better direction?
LOWER_IS_BETTER = {'stress': True, 'mood': False, 'belonging': True,
                   'energy': False, 'confidence': False}

# Stops two requests creating two accounts with one username.
new_account_lock = threading.Lock()


class InputError(Exception):
    '''
    Raised when the page sends an answer the program cannot accept.
    '''


class SignInRequired(Exception):
    '''
    Raised when a request needs a signed-in user and has none.
    '''


def check_int(value, low, high, what):
    '''
    Return value if it is a whole number from low to high, otherwise raise InputError.
    '''

    if type(value) != int or not low <= value <= high:
        raise InputError(f'{what} must be a whole number from {low} to {high}.')
    return value


def check_answers(values, count, low, high, what):
    '''
    Check a list of scale answers and return it.
    '''

    if type(values) != list or len(values) != count:
        raise InputError(f'Please answer every {what} question.')
    for value in values:
        check_int(value, low, high, f'{what} answers')
    return values


def check_list(values, options, what):
    '''
    Return the values that are in options, without repeats.
    '''

    if type(values) != list:
        raise InputError(f'{what} must be a list.')
    chosen = []
    for value in values:
        if value not in options:
            raise InputError(f'Not recognised: {value}.')
        if value not in chosen:
            chosen.append(value)
    return chosen


def public_user(user):
    '''
    Return the parts of the user dictionary the page shows.
    '''

    return {
        'name': user['name'],
        'personality': user['personality'],
        'interests': user['interests'],
        'setting': user['setting'],
        'atmosphere': user['atmosphere'],
        'learned': user['learned'],
        'ratings': user['ratings'],
        'checkins': user['checkins'],
    }


def level(value, cut_low, cut_high, words):
    '''
    Return words[0] if value <= cut_low, words[1] if value <= cut_high, otherwise words[2].
    '''

    if value <= cut_low:
        return words[0]
    elif value <= cut_high:
        return words[1]
    else:
        return words[2]


def card_row(key, label, value, low, high, cuts, verdict, meaning):
    '''
    Return one row of the state card as a dictionary.
    cuts are the scores where one band ends and the next begins.
    '''

    return {'key': key, 'label': label, 'value': value, 'low': low, 'high': high,
            'cuts': cuts, 'verdict': verdict, 'meaning': meaning}


def state_card(user, checkin):
    '''
    Return today's state card.
    '''

    size = today_size(user['personality'], checkin['energy'])
    mood = level(checkin['mood'], 28, 50, ['Very low mood', 'Low mood', 'Good mood'])
    if checkin['mood'] > 75:
        mood = 'Very good mood'

    rows = [
        card_row('stress', 'Stress', checkin['stress'], 0, 16, [5, 9],
                 level(checkin['stress'], 5, 9, ['Low stress', 'Moderate stress', 'High stress']),
                 'Higher means more stressed'),
        card_row('mood', 'Mood', checkin['mood'], 0, 100, [28, 50, 75], mood,
                 'Higher means happier'),
        card_row('belonging', 'Loneliness', checkin['belonging'], 3, 9, [5, 7],
                 level(checkin['belonging'], 5, 7, ['Connected', 'Somewhat isolated', 'Isolated']),
                 'Higher means more isolated'),
        card_row('confidence', 'Confidence', checkin['confidence'], 1, 10, [4, 7],
                 level(checkin['confidence'], 4, 7, ['Low', 'Medium', 'High']),
                 'Higher means more confident'),
        card_row('energy', 'Social energy', checkin['energy'], 1, 10, [4, 7],
                 level(checkin['energy'], 4, 7, ['Low energy', 'Medium energy', 'High energy']),
                 f'{size.title()} groups suit you today'),
    ]

    # Compare with the check-in before this one, if there is one.
    changes = []
    if len(user['checkins']) >= 2:
        before = user['checkins'][-2]
        for row in rows:
            diff = checkin[row['key']] - before[row['key']]
            better = (diff < 0) == LOWER_IS_BETTER[row['key']]
            changes.append({'label': row['label'], 'diff': diff, 'better': diff != 0 and better})

    focus = focus_area(checkin)
    return {
        'date': checkin['date'],
        'overall': overall_state(checkin['mood']),
        'rows': rows,
        'focus': focus,
        'focus_text': FOCUS_TEXT[focus],
        'size': size,
        'support': needs_support(checkin),
        'support_link': SUPPORT_LINK,
        'days': checkin['days'],
        'changes': changes,
        'before_date': user['checkins'][-2]['date'] if len(user['checkins']) >= 2 else None,
    }


def public_results(results):
    '''
    Return the recommendations as plain dictionaries for the page.
    '''

    output = []
    for result in results:
        event = result['event']
        output.append({
            'name': event['name'],
            'club': event['club'],
            'when': event['sessions'][0],
            'more_sessions': len(event['sessions']) - 1,
            'location': event['location'],
            'price': event['price'],
            'link': event['link'],
            'tags': event['tags'],
            'size': event['size'],
            'score': result['score'],
            'reasons': result['reasons'],
        })
    return output


def require_profile(user):
    '''
    Raise InputError if this user has not saved a profile yet.
    '''

    if user['personality'] is None:
        raise InputError('Please set up your profile first.')


def session_data(user):
    '''
    Return what the page needs to know about the person signed in.
    '''

    is_new = user['personality'] is None
    return {'username': user['username'], 'is_new': is_new,
            'user': None if is_new else public_user(user)}


def handle_register(body):
    '''
    Create an account and start a session, returning the session's token with the user.
    The account is saved now, so the password is kept before the profile is filled in.
    '''

    username = check_username(body.get('username', ''))
    password = body.get('password')
    check_new_password(password)
    salt, password_hash = hash_password(password)
    with new_account_lock:
        if find_user(username) is not None:
            raise AuthError('That username is taken.')
        user = new_user(username, salt, password_hash)
        save_user(user)
    return create_session(user['id']), session_data(user)


def handle_login(body):
    '''
    Check the password and start a session, returning the session's token with the user.
    The message does not say which part was wrong, so it cannot confirm that a username exists.
    '''

    username = str(body.get('username', '')).strip().lower()
    user = find_user(username)
    if user is None or not check_password(body.get('password', ''), user['salt'], user['password_hash']):
        raise AuthError('Wrong username or password.')
    return create_session(user['id']), session_data(user)


def handle_profile(user, body, events):
    '''
    Save the profile answers. Everything else in the user's file stays as it is.
    '''

    name = clean_name(body.get('name', ''))
    if name == '':
        raise InputError(f'Please enter a name of up to {MAX_NAME_LENGTH} characters.')
    personality = body.get('personality')
    setting = body.get('setting')
    atmosphere = body.get('atmosphere')
    if personality not in PERSONALITIES:
        raise InputError('Please choose what recharges you.')
    if setting not in SETTINGS or atmosphere not in ATMOSPHERES:
        raise InputError('Please choose a setting and an atmosphere.')
    interests = check_list(body.get('interests', []), INTERESTS, 'Interests')
    if len(interests) == 0:
        raise InputError('Please choose at least one interest.')

    user.update({
        'name': name,
        'personality': personality,
        'interests': interests,
        'setting': setting,
        'atmosphere': atmosphere,
    })
    save_user(user)
    return {'user': public_user(user)}


def handle_checkin(user, body, events):
    '''
    Score the answers, save the check-in and return the state card and recommendations.
    '''

    require_profile(user)

    pss = check_answers(body.get('pss'), len(PSS4_QUESTIONS), 0, 4, 'stress')
    who = check_answers(body.get('who'), len(WHO5_QUESTIONS), 0, 5, 'mood')
    ucla = check_answers(body.get('ucla'), len(UCLA3_QUESTIONS), 1, 3, 'belonging')
    energy = check_int(body.get('energy'), 1, 10, 'Energy')
    confidence = check_int(body.get('confidence'), 1, 10, 'Confidence')
    days = check_list(body.get('days', []), DAYS, 'Free days')
    if len(days) == 0:
        raise InputError('Please choose at least one free day.')

    checkin = {
        'date': datetime.date.today().strftime('%a %d %b %Y'),
        'stress': score_pss4(pss),
        'mood': score_who5(who),
        'belonging': score_ucla3(ucla),
        'energy': energy,
        'confidence': confidence,
        'days': days,
    }
    add_checkin(user, checkin)
    save_user(user)

    # Ratings from earlier sessions are already part of the scores.
    earlier = len(user['ratings'])
    results = recommend(user, checkin, events)
    return {
        'user': public_user(user),
        'card': state_card(user, checkin),
        'earlier_ratings': earlier,
        'recommendations': public_results(results),
    }


def handle_feedback(user, body, events):
    '''
    Update the learned weights from the 1-3 ratings and save them.
    '''

    require_profile(user)

    ratings = body.get('ratings', {})
    if type(ratings) != dict or len(ratings) == 0:
        raise InputError('Please rate every suggestion.')

    by_name = {}
    for event in events:
        by_name[event['name']] = event

    for event_name in ratings:
        if event_name not in by_name:
            raise InputError(f'Unknown event: {event_name}')
        rating = check_int(ratings[event_name], 1, 3, 'Ratings')
        update_learned(user, by_name[event_name], rating)
    save_user(user)
    return {'user': public_user(user)}


def handle_meta(events):
    '''
    Return the questions and options the page needs to draw its forms.
    '''

    return {
        'pss': {'questions': PSS4_QUESTIONS, 'choices': PSS4_CHOICES},
        'who': {'questions': WHO5_QUESTIONS, 'choices': WHO5_CHOICES},
        'ucla': {'questions': UCLA3_QUESTIONS, 'choices': UCLA3_CHOICES},
        'interests': INTERESTS,
        'days': DAYS,
        'event_count': len(events),
    }


# These start a session.
SIGN_IN_ROUTES = {
    '/api/register': handle_register,
    '/api/login': handle_login,
}

# These work only for a signed-in session. The user always comes from the
# session cookie, never from the request body, so nobody can act as someone else.
ROUTES = {
    '/api/profile': handle_profile,
    '/api/checkin': handle_checkin,
    '/api/feedback': handle_feedback,
}


class Handler(SimpleHTTPRequestHandler):
    '''
    Serves the files in web/ and answers the /api/ requests.
    '''

    events = []

    def __init__(self, *args, **kwargs):
        '''
        Set up the handler so that page files are served from the web/ folder only.
        '''

        super().__init__(*args, directory=WEB_FOLDER, **kwargs)

    def end_headers(self):
        '''
        Add a no-cache header to every response before the headers are finished.
        '''

        # Browsers must not keep old pages after an update, or copies of private answers.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def session_token(self):
        '''
        Return the session token from the request's cookie, or None if there is none.
        '''

        try:
            morsel = SimpleCookie(self.headers.get('Cookie', '')).get(SESSION_COOKIE)
        except CookieError:
            return None
        return None if morsel is None else morsel.value

    def session_user(self):
        '''
        Return the signed-in user, or None if this request has no live session.
        '''

        session = get_session(self.session_token())
        if session is None:
            return None
        return load_user(session['user_id'])

    def send_json(self, status, data, token=None, cookie_seconds=SESSION_SECONDS):
        '''
        Send data back to the page as JSON, setting the session cookie if a token is given.
        HttpOnly keeps it away from scripts; SameSite stops other sites sending it.
        '''

        text = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(text)))
        if token is not None:
            self.send_header('Set-Cookie', f'{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={cookie_seconds}')
        self.end_headers()
        self.wfile.write(text)

    def do_GET(self):
        '''
        Answer GET requests: the questions (/api/meta), who is signed in (/api/session),
        or a page file from web/.
        '''

        if self.path == '/api/meta':
            self.send_json(200, handle_meta(self.events))
        elif self.path == '/api/session':
            user = self.session_user()
            self.send_json(200, {'username': None} if user is None else session_data(user))
        else:
            super().do_GET()

    def do_POST(self):
        '''
        Answer POST requests: read the JSON body, pass it to the matching handle_ function,
        and turn any error into a JSON error message instead of crashing the server.
        '''

        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length) or b'{}')
            if type(body) != dict:
                raise InputError('Expected a JSON object.')
            if self.path in SIGN_IN_ROUTES:
                token, data = SIGN_IN_ROUTES[self.path](body)
                self.send_json(200, data, token)
            elif self.path == '/api/signout':
                end_session(self.session_token())
                self.send_json(200, {}, '', 0)
            elif self.path in ROUTES:
                user = self.session_user()
                if user is None:
                    raise SignInRequired()
                self.send_json(200, ROUTES[self.path](user, body, self.events))
            else:
                self.send_json(404, {'error': 'Not found.'})
        except (InputError, AuthError) as error:
            self.send_json(400, {'error': str(error)})
        except SignInRequired:
            self.send_json(401, {'error': 'Please sign in again.'})
        except json.JSONDecodeError:
            self.send_json(400, {'error': 'Expected a JSON object.'})

    def log_message(self, format, *args):
        '''
        Turn off the default log line printed for every request.
        '''

        # Keep the terminal quiet; only startup messages are printed.
        pass


def main():
    '''
    Start the server and open the app in the browser.
    '''

    # users/ and events.json are found relative to this folder.
    os.chdir(HERE)
    Handler.events = load_events('events.json')

    url = f'http://127.0.0.1:{PORT}/'

    # Only this computer can reach the server.
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        print(f'Port {PORT} is in use, so the app may already be running. Opening {url}')
        webbrowser.open(url)
        return

    print(f'ICare is running at {url}')
    print('Press Ctrl+C to stop.')
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped. Take care!')


if __name__ == '__main__':
    main()
