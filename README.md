# ICare -- Self-assessment of Wellbeing with Personalized Activity Match

COMP9001 Final Project. SID: 560769023

A short wellbeing check-in that shows how you are doing today, recommends three
USU club events that suit you, and learns from your ratings so the next
recommendations fit you better.

This program is not a diagnostic tool.

## Note for the tutor

- **Main script to run: `web_app.py`.**
- This is a **web-based application**. `web_app.py` uses Python's built-in
  `http.server` module to run a small server on this computer only
  (127.0.0.1, port 8001), and the interface opens in the browser.
  Because of this, it will not run inside Ed's environment; please run it on your own computer.
- No libraries outside Python's standard library are used.
- The page in `web/` is written in plain HTML, CSS and JavaScript (no frameworks).
  It only draws the forms and results: every score, recommendation and saved file
  is produced by the Python code.
- The page loads a font from Google Fonts. Without internet the app still works
  and uses a system font instead.

## How to run

You need Python 3.8 or newer. No extra packages are needed, only the Python
standard library.

1. Open a terminal in this folder.
2. Run:

   ```
   python3 web_app.py
   ```

   On Windows, use `python web_app.py` instead.

3. The app opens in your browser at http://127.0.0.1:8001/ .
   If it does not open by itself, copy that address into the browser.
4. Click **Create account**, choose a username and password, and fill in your profile.
5. Do a check-in, read your status card and the three recommendations,
   then rate each recommendation from 1 to 3.
6. Do another check-in to see the recommendations change.

Press `Ctrl+C` in the terminal to stop the server.

The server only accepts connections from this computer. Accounts are saved in
a `users/` folder, which is created the first time someone registers.

## How to run the tests

```
python3 -m unittest
```

The tests use a temporary folder, so they never change `users/`.

## How it works

1. **Profile** (asked once, can be edited later): interests, preferred setting
   and atmosphere (quiet or lively), and whether you recharge alone
   or in a group (introvert, ambivert or extrovert).
2. **Check-in** (every time): the days you are free, and five areas:

   | Area | Source | Score |
   |---|---|---|
   | Stress | PSS-4 (last month), items 2 and 3 reverse-scored | 0–16, higher means more stress |
   | Mood | WHO-5 (last two weeks), total × 4 | 0–100, higher is better |
   | Belonging | 3-item UCLA Loneliness Scale | 3–9, 6 or more means quite isolated |
   | Social energy | Self-rated 1–10, combined with personality | small, medium or large group today |
   | Confidence | Self-rated | 1–10 |

3. **Status card**: an overall state from the WHO-5 score (Running on Empty,
   Stretched Thin, Steady, Thriving), a bar for each area, the area that needs
   the most attention today ("Focus today"), and the change since the last check-in.
4. **Safety rule**: if stress is 12 or more, or mood is 28 or less, support
   services (USyd Counselling and Mental Health Support, Lifeline 13 11 14)
   are shown before the recommendations.
5. **Recommendations**: events on days you are not free are skipped. Every other
   event is scored, and the top three are shown with the reasons they scored:

   ```
   score = Interest Match + Need Fit + Social Fit + Setting Fit + Community Fit + Learned Bonus
   ```

   Need Fit favours events that help with the area you are struggling in.
   On a good day (no focus area), Good-day Fit is used instead and favours
   events whose group size suits your energy today.
6. **Learning from feedback**: rating an event 3 adds 1 to the learned weight of
   each of its tags, rating it 1 takes 1 away, and 2 changes nothing. Each weight
   stays between -3 and +3 and is added to the score of future events with that tag.

## Files

| File | Purpose |
|---|---|
| `web_app.py` | Starts the server, opens the browser and handles the page's requests |
| `questions.py` | Check-in questions, questionnaire scoring, overall state and focus area |
| `recommender.py` | Loads the events and scores them with the formula above |
| `user_profile.py` | Creates, loads and saves users, and updates learned weights from feedback |
| `auth.py` | Username and password checks, password hashing and sign-in sessions |
| `events.json` | 136 USU club events with tags, group size, relax level |
| `web/` | The web page: `index.html`, `style.css`, `app.js` and `ink.js` (ink-painting drawings) |
| `test_app.py` | 43 unit tests for scoring, recommending, passwords and the server |

## Advanced topics used

| Topic | Where |
|---|---|
| File I/O (JSON) | `recommender.load_events` reads `events.json`; `user_profile.save_user`, `load_user` and `find_user` read and write `users/<id>.json` |
| Error handling | Custom exceptions `InputError`, `SignInRequired` (`web_app.py`) and `AuthError` (`auth.py`); `Handler.do_POST` catches them with `try`/`except` and sends an error message instead of crashing |
| Classes (OOP) | `Handler` inherits from `SimpleHTTPRequestHandler` and overrides `do_GET`, `do_POST` and `end_headers`; the three exception classes inherit from `Exception` |
| Testing | `test_app.py`: 43 `unittest` tests, including a full journey through the running server |
| Nested data | `SIZE_TABLE` (personality x energy band), answer choices as lists of lists, events and users as dictionaries of lists |

## Privacy

Passwords are never saved: only a random salt and a slow hash of the password.
Sign-in sessions are kept in memory, so stopping the server signs everyone out.
