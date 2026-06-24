#!/usr/bin/env python3
import sys, os, time, urllib.request
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.0')
from gi.repository import Gtk, WebKit2, GLib

url = os.environ.get('PLAN1_URL', 'http://localhost:1998')

# wait up to 15s for the server to be ready
for _ in range(60):
    try:
        urllib.request.urlopen(url, timeout=1)
        break
    except:
        time.sleep(0.25)

win = Gtk.Window(title='plan1')
win.set_default_size(1280, 800)
web = WebKit2.WebView()
web.load_uri(url)
win.add(web)
win.show_all()
win.connect('destroy', Gtk.main_quit)
Gtk.main()
