from db import connect, progress_facts, save_recap
from llm import generate

# The model only rewords facts worked out in db.progress_facts(); these rules
# keep it from adding numbers of its own or talking about what stayed the same.
SYSTEM_PROMPT = """You are a concise strength coach writing a recap of one gym session.
You are given only the exercises that changed since the previous session.
Write at most two short sentences in plain English about those changes:
weight, sets and reps that went up or down, and new exercises.
Use only the facts you are given. Never invent or calculate numbers.
Never mention anything that stayed the same.
If the athlete left a note, take it into account.
No greetings, no emojis, no lists."""

# Saved without asking the model when nothing changed, so the card doesn't
# keep showing an older session's recap.
NO_CHANGES = "No changes since last time: same weight, sets and reps for every exercise."


def write_recap(workout_id: int) -> None:
    # Runs as a background task after "Complete workout". Reads the facts,
    # asks the model, and stores the answer on the log. Does nothing for an
    # empty log or when the model doesn't answer.
    with connect() as conn:
        result = progress_facts(conn, workout_id)
    if result is None:
        return
    day_name, facts, logged = result
    if logged == 0:
        return

    if not facts:
        text = NO_CHANGES
    else:
        # The connection is closed while the model runs (which can take a
        # while), so the database isn't held open meanwhile.
        prompt = f"Session: {day_name}\nChanges:\n" + "\n".join(f"- {fact}" for fact in facts)
        text = generate(SYSTEM_PROMPT, prompt)
        if text is None:
            return

    with connect() as conn:
        save_recap(conn, workout_id, text)
