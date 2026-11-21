from db import connect, progress_facts, save_recap
from llm import generate

# The model only rewords facts worked out in db.progress_facts(); these rules
# keep it from adding numbers of its own.
SYSTEM_PROMPT = """You are a concise strength coach writing a recap of one gym session.
Write at most two short sentences in plain English.
Use only the facts you are given. Never invent or calculate numbers.
Mention what went up, and anything stuck at the same weight for 3 or more sessions.
If the athlete left a note, take it into account.
No greetings, no emojis, no lists."""


def write_recap(workout_id: int) -> None:
    # Runs as a background task after "Complete workout". Reads the facts,
    # asks the model, and stores the answer on the log. Does nothing if
    # there's nothing to say or the model doesn't answer.
    with connect() as conn:
        result = progress_facts(conn, workout_id)
    if result is None:
        return
    day_name, facts = result
    if not facts:
        return

    # The connection is closed while the model runs (which can take a while),
    # so the database isn't held open meanwhile.
    prompt = f"Session: {day_name}\n" + "\n".join(f"- {fact}" for fact in facts)
    text = generate(SYSTEM_PROMPT, prompt)
    if text is None:
        return

    with connect() as conn:
        save_recap(conn, workout_id, text)
