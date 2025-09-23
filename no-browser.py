import webbrowser
import sys

# Disable webbrowser.open to prevent automatic browser opening
webbrowser.open = lambda *args, **kwargs: None
webbrowser.open_new = lambda *args, **kwargs: None
webbrowser.open_new_tab = lambda *args, **kwargs: None

# Import and run spotdl after disabling browser
from spotdl.__main__ import console_entry_point

if __name__ == "__main__":
    console_entry_point()