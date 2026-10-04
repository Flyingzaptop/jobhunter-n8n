"""Send one independent message to the already loaded LM Studio model."""

import argparse
import json
import sys
import urllib.error
import urllib.request


def ask(prompt: str, max_tokens: int = 2048) -> str:
    payload = {
        "model": "jobhunter-gemma4",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "stream": False,
    }
    request = urllib.request.Request(
        "http://127.0.0.1:1234/v1/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=3600) as response:
        result = json.load(response)
    return result["choices"][0]["message"]["content"]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", nargs="?", help="Message; omit to enter it interactively")
    parser.add_argument("--max-tokens", type=int, default=2048)
    args = parser.parse_args()
    if not 1 <= args.max_tokens <= 8192:
        parser.error("--max-tokens must be between 1 and 8192")
    try:
        prompt = args.prompt if args.prompt is not None else input("Message: ")
        if not prompt.strip():
            parser.error("Message cannot be empty")
        print(ask(prompt, args.max_tokens))
        return 0
    except urllib.error.HTTPError as error:
        print(f"LM Studio returned HTTP {error.code}.", file=sys.stderr)
    except (urllib.error.URLError, TimeoutError):
        print("LM Studio is unavailable or the request timed out.", file=sys.stderr)
    except (KeyError, IndexError, TypeError, ValueError):
        print("LM Studio returned an unexpected response.", file=sys.stderr)
    except (EOFError, KeyboardInterrupt):
        return 130
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
