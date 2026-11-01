'''
Check-in questions and how they are scored.
Stress uses the PSS-4, mood uses the WHO-5 and belonging uses the 3-item UCLA Loneliness Scale.
Social energy and confidence are self-rated.
'''

# PSS-4 (Perceived Stress Scale, 4 items), asked about the last month.
PSS4_QUESTIONS = [
    'In the last month, how often have you felt that you were unable to control the important things in your life?',
    'In the last month, how often have you felt confident about your ability to handle your personal problems?',
    'In the last month, how often have you felt that things were going your way?',
    'In the last month, how often have you felt difficulties were piling up so high that you could not overcome them?',
]
# Questions 2 and 3 (indexes 1 and 2) are positively worded, so they are reverse scored.
PSS4_REVERSED = [1, 2]

# WHO-5 Well-Being Index, asked about the last two weeks.
WHO5_QUESTIONS = [
    'Over the last two weeks, I have felt cheerful and in good spirits.',
    'Over the last two weeks, I have felt calm and relaxed.',
    'Over the last two weeks, I have felt active and vigorous.',
    'Over the last two weeks, I woke up feeling fresh and rested.',
    'Over the last two weeks, my daily life has been filled with things that interest me.',
]

# 3-item UCLA Loneliness Scale.
UCLA3_QUESTIONS = [
    'How often do you feel that you lack companionship?',
    'How often do you feel left out?',
    'How often do you feel isolated from others?',
]

DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

# Group size that suits today, by personality and today's social energy band.
SIZE_TABLE = {
    'introvert': ['small', 'small', 'medium'],
    'ambivert': ['small', 'medium', 'medium'],
    'extrovert': ['small', 'medium', 'large'],
}

# Cut-offs that decide when support resources are shown first.
HIGH_STRESS = 12
LOW_MOOD = 28
# A need value (0-1) must reach this level to be shown as today's focus.
FOCUS_LEVEL = 0.4


def score_pss4(answers):
    '''
    Return the PSS-4 total from 0 to 16; a higher score means more stress.
    '''

    total = 0
    for i in range(len(answers)):
        if i in PSS4_REVERSED:
            total += 4 - answers[i]
        else:
            total += answers[i]
    return total


def score_who5(answers):
    '''
    Return the WHO-5 score as a percentage from 0 to 100; a higher score means better wellbeing.
    '''

    return sum(answers) * 4


def score_ucla3(answers):
    '''
    Return the UCLA-3 total from 3 to 9; 6 or more means feeling lonely.
    '''

    return sum(answers)


def today_size(personality, energy):
    '''
    Combine personality (trait) with today's social energy (state) and return the best group size.
    '''

    if energy <= 4:
        band = 0
    elif energy <= 7:
        band = 1
    else:
        band = 2
    return SIZE_TABLE[personality][band]


def overall_state(mood):
    '''
    Turn the WHO-5 percentage into an overall state name.
    '''

    if mood <= 28:
        return 'RUNNING ON EMPTY'
    elif mood <= 50:
        return 'STRETCHED THIN'
    elif mood <= 75:
        return 'STEADY'
    else:
        return 'THRIVING'


def focus_area(checkin):
    '''
    Return the area that needs the most attention today, or 'none' if every area looks fine.
    Each score is turned into a 0-1 "need" value so different scales can be compared.
    '''

    needs = {
        'stress': checkin['stress'] / 16,
        'mood': (100 - checkin['mood']) / 100,
        'belonging': (checkin['belonging'] - 3) / 6,
        'confidence': (10 - checkin['confidence']) / 9,
    }

    best = 'stress'
    for area in needs:
        if needs[area] > needs[best]:
            best = area

    # Below this level nothing really stands out.
    if needs[best] < FOCUS_LEVEL:
        return 'none'
    return best


def needs_support(checkin):
    '''
    Return True when stress is very high or mood is very low.
    '''

    return checkin['stress'] >= HIGH_STRESS or checkin['mood'] <= LOW_MOOD
