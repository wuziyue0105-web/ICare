'''
Scores every USU event for one user and one check-in.
score = Interest Match + Need Fit + Social Fit + Setting Fit + Community Fit + Learned Bonus
On a good day (no focus area), Good-day Fit is used in place of Need Fit.
'''

import json

from questions import today_size, focus_area

# Group sizes from smallest to largest, used to measure how far apart two sizes are.
SIZES = ['small', 'medium', 'large']


def load_events(filename):
    '''
    Read the JSON events file and return a list of event dictionaries.
    '''

    with open(filename) as file:
        events = json.load(file)
    return events


def interest_match(user, event, reasons):
    '''
    Two points for every event tag the user enjoys.
    '''

    score = 0
    for tag in event['tags']:
        if tag in user['interests']:
            score += 2
            reasons.append(f'you enjoy {tag}')
    return score


def need_fit(checkin, event, reasons):
    '''
    Points for events that help with today's stress, mood and belonging.
    '''

    score = 0

    # Stress: the higher it is, the more a relaxing event helps.
    if checkin['stress'] >= 10 and event['relax'] >= 7:
        score += 3
        reasons.append('your stress is high and this event is relaxing')
    elif 6 <= checkin['stress'] <= 9 and event['relax'] >= 6:
        score += 1
        reasons.append('this event is fairly relaxing')

    # Mood: a low mood is matched with wellness or outdoor events.
    if checkin['mood'] <= 50:
        if 'wellness' in event['tags'] or 'outdoor' in event['tags']:
            score += 1
            reasons.append('wellness and outdoor time can lift your mood')

    # Belonging: a lonely user is matched with communities or small groups.
    if checkin['belonging'] >= 6:
        if event['community'] is not None or event['size'] == 'small':
            score += 2
            reasons.append('a small or close-knit group is easier for making connections')

    return score


def good_day_fit(user, checkin, event, reasons):
    '''
    Points used in place of Need Fit when every area looks fine (focus is 'none').
    On a good day there is nothing to fix, so the group size that suits today counts for more:
    the right size gets 2 more points, and a size two steps away (small and large) loses 2 points.
    '''

    size = today_size(user['personality'], checkin['energy'])
    # How many steps apart the event's size and today's size are: 0, 1 or 2.
    gap = abs(SIZES.index(event['size']) - SIZES.index(size))

    if gap == 0:
        reasons.append(f'you are doing well today, so a {size} group that fits you is ranked higher')
        return 2
    elif gap == 2:
        reasons.append(f'a {event["size"]} group is far from the {size} group that suits you today')
        return -2
    return 0


def social_fit(user, checkin, event, reasons):
    '''
    Points when the group size suits today, a penalty for a large crowd on a low-energy day.
    '''

    score = 0
    size = today_size(user['personality'], checkin['energy'])

    if event['size'] == size:
        score += 2
        reasons.append(f'a {size} group suits your energy today')
    if checkin['energy'] <= 4 and event['size'] == 'large':
        score -= 2
    return score


def setting_fit(user, event, reasons):
    '''
    Points for matching the indoor/outdoor and quiet/active preferences.
    '''

    score = 0

    if user['setting'] == 'outdoor' and 'outdoor' in event['tags']:
        score += 1
        reasons.append('it is outdoors, as you like')

    # Quiet and active are judged from how relaxing the event is.
    if user['atmosphere'] == 'quiet' and event['relax'] >= 7:
        score += 1
        reasons.append('it has the quiet feel you prefer')
    elif user['atmosphere'] == 'active' and event['relax'] <= 4:
        score += 1
        reasons.append('it has the lively feel you prefer')

    return score


def community_fit(user, event, reasons):
    '''
    Two points when the event belongs to a community the user chose.
    '''

    if event['community'] in user['communities']:
        reasons.append(f'it is part of the {event["community"]} community you chose')
        return 2
    return 0


def learned_bonus(user, event, reasons):
    '''
    Add the learned weight of every tag, built from the user's past ratings.
    '''

    bonus = 0
    for tag in event['tags']:
        bonus += user['learned'].get(tag, 0)

    if bonus > 0:
        reasons.append(f'you liked similar events before (+{bonus})')
    elif bonus < 0:
        reasons.append(f'you did not enjoy similar events before ({bonus})')
    return bonus


def score_event(user, checkin, event):
    '''
    Return (score, reasons) for one event, or None if the user is not free that day.
    '''

    # Find the days when the event runs and the user is free.
    free_days = [day for day in event['days'] if day in checkin['days']]
    if len(free_days) == 0:
        return None

    reasons = []
    score = 0
    score += interest_match(user, event, reasons)
    # Need Fit helps with a hard day; Good-day Fit replaces it when nothing stands out.
    if focus_area(checkin) == 'none':
        score += good_day_fit(user, checkin, event, reasons)
    else:
        score += need_fit(checkin, event, reasons)
    score += social_fit(user, checkin, event, reasons)
    score += setting_fit(user, event, reasons)
    score += community_fit(user, event, reasons)
    score += learned_bonus(user, event, reasons)
    return score, reasons


def get_score(result):
    '''
    Return the score of one result, used as the sorting key.
    '''

    return result['score']


def recommend(user, checkin, events, top_n=3):
    '''
    Score every event and return the best top_n results, highest score first.
    '''

    results = []
    for event in events:
        # Already rated, so show something new instead.
        if event['name'] in user['ratings']:
            continue
        outcome = score_event(user, checkin, event)
        # Skip events on busy days, and events that do not fit at all.
        if outcome is None or outcome[0] <= 0:
            continue
        score, reasons = outcome
        results.append({'event': event, 'score': score, 'reasons': reasons})

    results.sort(key=get_score, reverse=True)
    return results[:top_n]
