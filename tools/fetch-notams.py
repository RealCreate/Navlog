#!/usr/bin/env python3
"""Fetch current NOTAMs for the school's aerodromes into data/notams.json.

Runs in CI (the browser cannot call NOTAM services directly). Source: the FAA NOTAM Search
service, which republishes ICAO NOTAMs worldwide, including Spain's LExx aerodromes and the
Madrid FIR. The official Spanish source is ICARO (notampib.enaire.es); the app keeps the link
to it and marks these NOTAMs as a convenience copy to be checked there before flight.
"""
import json, sys, time, urllib.parse, urllib.request

LOCS = ['LEBG', 'LERJ', 'LEVT', 'LEVD', 'LELN', 'LEPP', 'LESO', 'LEHC', 'LEXJ', 'LESA', 'LEBB', 'LEZG', 'LECM']
URL = 'https://notams.aim.faa.gov/notamSearch/search'


def fetch(loc):
    out, offset = [], 0
    while True:
        body = urllib.parse.urlencode({
            'searchType': 0, 'designatorsForLocation': loc, 'offset': offset,
            'notamsOnly': 'false', 'radius': 10, 'sortColumns': '5 false', 'sortDirection': 'true',
        }).encode()
        req = urllib.request.Request(URL, data=body, headers={
            'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (navlog CI)',
        })
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.load(r)
        items = data.get('notamList') or []
        for n in items:
            out.append({
                'id': n.get('notamNumber'), 'loc': n.get('facilityDesignator') or n.get('icaoId') or loc,
                'from': n.get('startDate'), 'to': n.get('endDate'),
                'text': (n.get('icaoMessage') or n.get('traditionalMessage') or '').strip(),
            })
        total = data.get('totalNotamCount') or len(out)
        offset += len(items)
        if not items or offset >= total or offset > 300:
            return out


def main(path):
    res = {'fetched': time.strftime('%Y-%m-%dT%H:%MZ', time.gmtime()), 'source': 'FAA NOTAM Search (ICAO NOTAMs)', 'ok': True, 'notams': {}}
    errors = []
    for loc in LOCS:
        try:
            res['notams'][loc] = fetch(loc)
        except Exception as e:  # keep going: one failing location must not lose the rest
            errors.append(f'{loc}: {e}')
    if errors:
        res['errors'] = errors
    res['ok'] = any(res['notams'].values())
    with open(path, 'w') as f:
        json.dump(res, f, ensure_ascii=False)
    print(f"NOTAMs: {sum(len(v) for v in res['notams'].values())} for {len(res['notams'])} locations; errors: {errors}")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'notams.json')
