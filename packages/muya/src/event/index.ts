import type { IEvent, IListeners, Listener } from './types';

// TODO: @Jocs use the same name function in utils.
function* uniqueIdGenerator() {
    let id = 0;

    while (true)
        yield id++;
}
const PREFIX = 'event-';
const idIterator = uniqueIdGenerator();

class EventCenter {
    public events: IEvent[] = [];
    public listeners: IListeners = {};

    // Answers "is this exact binding already here" without walking `events`.
    //
    // The walk was once per bind over a table that grows with the document —
    // roughly one entry per block, so 8000 blocks meant 33 million comparisons
    // and 16000 meant four times that. Quadratic, and it bit hardest on the
    // large files the editor is meant to handle.
    //
    // `events` stays the source of truth (and stays public — the listener-leak
    // spec counts it). This only indexes it, by target. One list per target
    // rather than a map keyed by event name: a single element carries a handful
    // of listeners, so the list is short enough to scan, and a map per target
    // costs more memory than the scan saves — measured at 150 bytes a block.
    //
    // Scanning also preserves the `===` comparison the check has always used,
    // which matters for a `capture` passed as an options object.
    //
    // Weak on the target so a removed element takes its list with it.
    private _bound = new WeakMap<HTMLElement | Document, IEvent[]>();

    private get _eventId() {
        return `${PREFIX}${idIterator.next().value}`;
    }

    /**
     * [attachDOMEvent] bind event listener to target, and return a unique ID,
     * this ID
     */
    attachDOMEvent(
        target: HTMLElement | Document,
        event: string,
        listener: EventListener,
        capture?: boolean | AddEventListenerOptions,
    ): string {
        let bound = this._bound.get(target);
        if (!bound) {
            bound = [];
            this._bound.set(target, bound);
        }

        if (bound.some(e => e.event === event && e.listener === listener && e.capture === capture))
            return '';

        const eventId = this._eventId;
        target.addEventListener(event, listener, capture);
        const entry: IEvent = {
            eventId,
            target,
            event,
            listener,
            capture,
        };
        this.events.push(entry);
        bound.push(entry);

        return eventId;
    }

    /**
     * [detachDOMEvent removeEventListener]
     * @param  {[type]} eventId [unique eventId]
     */
    detachDOMEvent(eventId: string) {
        if (!eventId)
            return false;

        const removeEvent = this.events.find(e => e.eventId === eventId);
        if (removeEvent) {
            const { target, event, listener, capture } = removeEvent;
            target.removeEventListener(event, listener, capture);
            const index = this.events.indexOf(removeEvent);
            this.events.splice(index, 1);

            // Must come off the index too, or re-binding the same listener
            // after detaching it would be mistaken for a duplicate and
            // silently dropped.
            const bound = this._bound.get(target);
            const boundIndex = bound?.indexOf(removeEvent) ?? -1;
            if (bound && boundIndex !== -1)
                bound.splice(boundIndex, 1);
        }
    }

    /**
     * [detachAllDomEvents remove all the DOM events handler]
     */
    detachAllDomEvents() {
        for (const removedEvent of this.events) {
            const { target, event, listener, capture } = removedEvent;
            target.removeEventListener(event, listener, capture);
        }

        this.events = [];
        this._bound = new WeakMap();
    }

    /**
     * inner method for on and once
     */
    subscribe(event: string, listener: Listener, once = false) {
        const listeners = this.listeners[event];
        const handler = { listener, once };
        if (listeners && Array.isArray(listeners))
            listeners.push(handler);
        else
            this.listeners[event] = [handler];
    }

    /**
     * [on] on custom event
     */
    on(event: string, listener: Listener) {
        this.subscribe(event, listener);
    }

    /**
     * [off] off custom event
     */
    off(event: string, listener: Listener) {
        const listeners = this.listeners[event];
        if (
            Array.isArray(listeners)
            && listeners.some(l => l.listener === listener)
        ) {
            const index = listeners.findIndex(l => l.listener === listener);
            listeners.splice(index, 1);
        }
    }

    /**
     * [once] subscribe event and listen once
     */
    once(event: string, listener: Listener) {
        this.subscribe(event, listener, true);
    }

    /**
     * emit custom event
     */
    emit(event: string, ...data: unknown[]) {
        const eventListener = this.listeners[event];

        if (eventListener && Array.isArray(eventListener)) {
            // Snapshot before iterating: a once-listener removes itself via
            // off() during emit, which mutates the same array and causes
            // forEach to skip the adjacent element. Iterate a copy instead.
            eventListener.slice().forEach(({ listener, once }) => {
                listener(...data);
                if (once)
                    this.off(event, listener);
            });
        }
    }

    /**
     * Remove all pub/sub subscriptions. Called from muya.destroy() to
     * release listener closures so the host page can GC the Muya instance.
     */
    unsubscribeAll() {
        this.listeners = {};
    }
}

export default EventCenter;
