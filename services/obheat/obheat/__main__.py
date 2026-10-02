import sys

from obheat.collect import main as collect_main
from obheat.serve import main as serve_main

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if cmd == "collect":
        collect_main()
    else:
        if cmd == "serve":
            sys.argv.pop(1)
        serve_main()
