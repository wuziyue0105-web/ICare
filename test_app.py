'''
Tests for scoring, recommending, passwords and the web server.
Accounts are written to a temporary folder, so the real users/ folder is never touched.
Run with: python3 -m unittest
'''

import glob
import http.client
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

import auth
import user_profile
import web_app
from questions import (score_pss4, score_who5, score_ucla3, today_size, overall_state,
                       focus_area, needs_support)
from recommender import load_events, recommend

HERE = os.path.dirname(os.path.abspath(__file__))
EVENTS = load_events(os.path.join(HERE, 'events.json'))
PASSWORD = 'correct horse 1'
PROFILE = {'name': 'Olivia', 'personality': 'introvert', 'interests': ['music'],
           'setting': 'either', 'atmosphere': 'quiet'}
CHECKIN = {'pss': [1, 2, 2, 1], 'who': [3, 3, 3, 3, 3], 'ucla': [1, 2, 1], 'energy': 6,
           'confidence': 6, 'days': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}


class ScoringTests(unittest.TestCase):
    '''
    The check-in scales, including the edges of each band.
    '''

    def test_pss4_reverses_questions_two_and_three(self):
        self.assertEqual(score_pss4([0, 4, 4, 0]), 0)
        self.assertEqual(score_pss4([4, 0, 0, 4]), 16)

    def test_who5_is_a_percentage(self):
        self.assertEqual(score_who5([0, 0, 0, 0, 0]), 0)
        self.assertEqual(score_who5([5, 5, 5, 5, 5]), 100)

    def test_ucla3_adds_the_answers(self):
        self.assertEqual(score_ucla3([1, 2, 3]), 6)

    def test_group_size_depends_on_personality_and_energy(self):
        self.assertEqual(today_size('introvert', 8), 'medium')
        self.assertEqual(today_size('extrovert', 8), 'large')
        self.assertEqual(today_size('extrovert', 4), 'small')

    def test_overall_state_bands(self):
        self.assertEqual(overall_state(28), 'RUNNING ON EMPTY')
        self.assertEqual(overall_state(50), 'STRETCHED THIN')
        self.assertEqual(overall_state(75), 'STEADY')
        self.assertEqual(overall_state(76), 'THRIVING')

    def test_focus_area_picks_the_biggest_need(self):
        checkin = {'stress': 16, 'mood': 60, 'belonging': 4, 'confidence': 8}
        self.assertEqual(focus_area(checkin), 'stress')

    def test_focus_area_is_none_on_a_good_day(self):
        checkin = {'stress': 1, 'mood': 90, 'belonging': 3, 'confidence': 9}
        self.assertEqual(focus_area(checkin), 'none')

    def test_support_shows_for_high_stress_or_low_mood(self):
        self.assertTrue(needs_support({'stress': 12, 'mood': 90}))
        self.assertTrue(needs_support({'stress': 0, 'mood': 28}))
        self.assertFalse(needs_support({'stress': 11, 'mood': 29}))


class RecommenderTests(unittest.TestCase):
    '''
    The rules that hold for every recommendation.
    '''

    def setUp(self):
        self.user = {'personality': 'ambivert', 'interests': ['music', 'food'], 'setting': 'either',
                     'atmosphere': 'either', 'learned': {}, 'ratings': {}}
        self.checkin = {'stress': 7, 'mood': 50, 'belonging': 6, 'energy': 6, 'confidence': 5,
                        'days': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}

    def test_returns_three_best_first(self):
        results = recommend(self.user, self.checkin, EVENTS)
        scores = [result['score'] for result in results]
        self.assertEqual(len(results), 3)
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_every_result_gives_reasons(self):
        for result in recommend(self.user, self.checkin, EVENTS):
            self.assertGreater(len(result['reasons']), 0)

    def test_only_free_days_are_used(self):
        self.checkin['days'] = ['Sat']
        for result in recommend(self.user, self.checkin, EVENTS):
            self.assertIn('Sat', result['event']['days'])

    def test_no_free_days_means_no_results(self):
        self.checkin['days'] = []
        self.assertEqual(recommend(self.user, self.checkin, EVENTS), [])

    def test_rated_events_are_not_suggested_again(self):
        first = recommend(self.user, self.checkin, EVENTS)
        for result in first:
            self.user['ratings'][result['event']['name']] = 2
        names = [result['event']['name'] for result in recommend(self.user, self.checkin, EVENTS)]
        for result in first:
            self.assertNotIn(result['event']['name'], names)


class LearnedWeightTests(unittest.TestCase):
    '''
    Ratings change the learned tag weights, within their limits.
    '''

    def setUp(self):
        self.user = {'learned': {}, 'ratings': {}}
        self.event = {'name': 'Jam', 'tags': ['music']}

    def test_loved_adds_and_not_for_me_takes_away(self):
        user_profile.update_learned(self.user, self.event, 3)
        self.assertEqual(self.user['learned']['music'], 1)
        user_profile.update_learned(self.user, self.event, 1)
        self.assertEqual(self.user['learned']['music'], 0)

    def test_okay_changes_nothing_but_is_saved(self):
        user_profile.update_learned(self.user, self.event, 2)
        self.assertEqual(self.user['learned'], {})
        self.assertEqual(self.user['ratings'], {'Jam': 2})

    def test_weights_stay_in_range(self):
        for attempt in range(5):
            user_profile.update_learned(self.user, self.event, 3)
        self.assertEqual(self.user['learned']['music'], user_profile.LEARNED_MAX)


class PasswordTests(unittest.TestCase):
    '''
    Hashing passwords and checking usernames.
    '''

    def setUp(self):
        patcher = mock.patch.object(auth, 'HASH_ROUNDS', 1000)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_right_and_wrong_password(self):
        salt, password_hash = auth.hash_password(PASSWORD)
        self.assertTrue(auth.check_password(PASSWORD, salt, password_hash))
        self.assertFalse(auth.check_password('wrong', salt, password_hash))

    def test_same_password_hashes_differently_for_each_user(self):
        self.assertNotEqual(auth.hash_password(PASSWORD), auth.hash_password(PASSWORD))

    def test_username_ignores_case_and_spaces(self):
        self.assertEqual(auth.check_username(' Alex_1 '), 'alex_1')

    def test_bad_usernames_are_rejected(self):
        for username in ['', 'ab', 'a b', '../x', 'a/b', 'a' * 31]:
            with self.assertRaises(auth.AuthError):
                auth.check_username(username)

    def test_bad_passwords_are_rejected(self):
        for password in ['short', 'x' * 129, 12345678, None]:
            with self.assertRaises(auth.AuthError):
                auth.check_new_password(password)


class ServerTests(unittest.TestCase):
    '''
    The whole app through its real web requests.
    '''

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder)
        for patcher in [mock.patch.object(user_profile, 'USERS_FOLDER', self.folder),
                        mock.patch.object(auth, 'HASH_ROUNDS', 1000),
                        mock.patch.object(web_app.Handler, 'events', EVENTS)]:
            patcher.start()
            self.addCleanup(patcher.stop)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), web_app.Handler)
        threading.Thread(target=self.server.serve_forever, args=(0.01,), daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, path, body=None, cookie=None):
        '''
        Make one request and return (status, data, the Set-Cookie header).
        '''

        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1])
        self.addCleanup(connection.close)
        headers = {'Cookie': cookie} if cookie else {}
        text = None if body is None else json.dumps(body)
        connection.request('GET' if body is None else 'POST', path, text, headers)
        response = connection.getresponse()
        raw = response.read()
        data = json.loads(raw) if 'json' in response.getheader('Content-Type', '') else raw
        return response.status, data, response.getheader('Set-Cookie')

    def register(self, username='olivia'):
        '''
        Create an account and return its session cookie.
        '''

        status, data, cookie = self.call('/api/register', {'username': username, 'password': PASSWORD})
        self.assertEqual(status, 200, data)
        return cookie.split(';')[0]

    def saved(self, username):
        '''
        Return the saved file of this user, or None.
        '''

        for path in glob.glob(os.path.join(self.folder, '*.json')):
            with open(path) as file:
                user = json.load(file)
            if user.get('username') == username:
                return user
        return None

    def test_private_routes_need_a_session(self):
        for path in web_app.ROUTES:
            self.assertEqual(self.call(path, {})[0], 401)
        self.assertEqual(self.call('/api/profile', PROFILE, 'session=forged')[0], 401)

    def test_nobody_is_signed_in_at_first(self):
        self.assertEqual(self.call('/api/session')[1], {'username': None})

    def test_cookie_cannot_be_read_by_scripts(self):
        cookie = self.call('/api/register', {'username': 'olivia', 'password': PASSWORD})[2]
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)

    def test_responses_are_not_cached(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1])
        self.addCleanup(connection.close)
        connection.request('GET', '/api/session')
        self.assertEqual(connection.getresponse().getheader('Cache-Control'), 'no-store')

    def test_password_is_never_saved_or_sent(self):
        cookie = self.register()
        user = self.saved('olivia')
        self.assertNotIn(PASSWORD, json.dumps(user))
        self.assertTrue(user['salt'] and user['password_hash'])
        replies = [self.call('/api/profile', PROFILE, cookie)[1],
                   self.call('/api/session', None, cookie)[1],
                   self.call('/api/login', {'username': 'olivia', 'password': PASSWORD})[1]]
        self.assertEqual(replies[1]['user']['name'], 'Olivia')
        for reply in replies:
            self.assertNotIn('salt', json.dumps(reply))
            self.assertNotIn('password_hash', json.dumps(reply))

    def test_files_are_named_by_id(self):
        self.register()
        user = self.saved('olivia')
        self.assertRegex(user['id'], r'^[0-9a-f]{32}$')
        self.assertTrue(os.path.exists(os.path.join(self.folder, f'{user["id"]}.json')))

    def test_usernames_are_unique_whatever_the_case(self):
        self.register('olivia')
        status, data, _ = self.call('/api/register', {'username': 'OLIVIA', 'password': PASSWORD})
        self.assertEqual((status, data['error']), (400, 'That username is taken.'))

    def test_two_requests_cannot_take_one_username(self):
        statuses = []
        def attempt():
            statuses.append(self.call('/api/register', {'username': 'race', 'password': PASSWORD})[0])
        threads = [threading.Thread(target=attempt) for number in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(statuses), [200, 400, 400, 400])

    def test_login_failures_look_the_same(self):
        self.register()
        wrong_password = self.call('/api/login', {'username': 'olivia', 'password': 'wrong-password'})
        unknown_user = self.call('/api/login', {'username': 'nobody', 'password': 'wrong-password'})
        self.assertEqual(wrong_password[:2], unknown_user[:2])
        self.assertEqual(wrong_password[0], 400)

    def test_login_survives_odd_input(self):
        self.register()
        for password in [None, ['x'], 123, 'pässwörd']:
            self.assertEqual(self.call('/api/login', {'username': 'olivia', 'password': password})[0], 400)

    def test_files_without_a_username_are_skipped(self):
        with open(os.path.join(self.folder, 'old.json'), 'w') as file:
            json.dump({'id': 'old', 'contact': 'old@example.com'}, file)
        self.assertEqual(self.call('/api/login', {'username': 'old', 'password': PASSWORD})[0], 400)
        self.register()

    def test_unfinished_signup_returns_to_the_profile(self):
        self.register()
        data = self.call('/api/login', {'username': 'olivia', 'password': PASSWORD})[1]
        self.assertTrue(data['is_new'])

    def test_checkin_needs_a_profile(self):
        self.assertEqual(self.call('/api/checkin', CHECKIN, self.register())[0], 400)

    def test_profile_form_cannot_change_the_account(self):
        cookie = self.register('alex')
        before = self.saved('alex')
        other = dict(PROFILE, id='someone-else', username='someone', password_hash='x')
        self.assertEqual(self.call('/api/profile', other, cookie)[0], 200)
        after = self.saved('alex')
        for key in ['id', 'username', 'salt', 'password_hash']:
            self.assertEqual(after[key], before[key])

    def test_two_users_can_share_a_display_name(self):
        for username in ['olivia', 'alex']:
            self.call('/api/profile', PROFILE, self.register(username))
        self.assertEqual(self.saved('olivia')['name'], self.saved('alex')['name'])
        self.assertNotEqual(self.saved('olivia')['id'], self.saved('alex')['id'])

    def test_bad_profile_answers_are_rejected(self):
        cookie = self.register()
        for change in [{'name': ''}, {'name': 'x' * 41}, {'personality': 'shy'}, {'setting': 'moon'},
                       {'interests': []}, {'interests': ['flying']}]:
            self.assertEqual(self.call('/api/profile', dict(PROFILE, **change), cookie)[0], 400)

    def test_bad_checkin_answers_are_rejected(self):
        cookie = self.register()
        self.call('/api/profile', PROFILE, cookie)
        for change in [{'pss': [1, 2]}, {'pss': [9, 0, 0, 0]}, {'energy': 11}, {'energy': '5'},
                       {'days': []}, {'days': ['Someday']}]:
            self.assertEqual(self.call('/api/checkin', dict(CHECKIN, **change), cookie)[0], 400)

    def test_bad_json_is_rejected(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1])
        self.addCleanup(connection.close)
        connection.request('POST', '/api/login', 'not json')
        self.assertEqual(connection.getresponse().status, 400)

    def test_unknown_routes_and_user_files_are_not_found(self):
        self.assertEqual(self.call('/api/nothing', {})[0], 404)
        self.assertEqual(self.call('/users/anyone.json')[0], 404)

    def test_sign_out_ends_the_session(self):
        cookie = self.register()
        status, _, reply = self.call('/api/signout', {}, cookie)
        self.assertEqual(status, 200)
        self.assertIn('Max-Age=0', reply)
        self.assertEqual(self.call('/api/session', None, cookie)[1], {'username': None})

    def test_sessions_expire(self):
        cookie = self.register()
        later = time.time() + auth.SESSION_SECONDS + 1
        with mock.patch.object(auth.time, 'time', return_value=later):
            self.assertEqual(self.call('/api/profile', PROFILE, cookie)[0], 401)

    def test_whole_journey(self):
        cookie = self.register()
        self.assertEqual(self.call('/api/profile', PROFILE, cookie)[0], 200)

        status, first, _ = self.call('/api/checkin', CHECKIN, cookie)
        self.assertEqual(status, 200)
        self.assertEqual(len(first['recommendations']), 3)
        self.assertEqual(first['card']['changes'], [])

        names = [rec['name'] for rec in first['recommendations']]
        status, data, _ = self.call('/api/feedback', {'ratings': {name: 3 for name in names}}, cookie)
        self.assertEqual(status, 200)
        self.assertEqual(len(data['user']['ratings']), 3)
        self.assertGreater(len(data['user']['learned']), 0)

        second = self.call('/api/checkin', CHECKIN, cookie)[1]
        self.assertEqual(len(second['card']['changes']), 5)
        for rec in second['recommendations']:
            self.assertNotIn(rec['name'], names)

        self.call('/api/signout', {}, cookie)
        data = self.call('/api/login', {'username': ' OLIVIA ', 'password': PASSWORD})[1]
        self.assertFalse(data['is_new'])
        self.assertEqual(len(data['user']['checkins']), 2)


if __name__ == '__main__':
    unittest.main()
