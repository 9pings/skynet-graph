// Tiny studio ws client: request/response correlated by id, plus event push.
// Auto-reconnects; queues calls issued before the socket is open.
export function connect( url, onEvent ) {
	let ws, nextId = 0;
	const pending = new Map();
	const queue = [];
	let statusCb = () => {};

	function setStatus( s ) { statusCb(s); }

	function open() {
		ws = new WebSocket(url);
		ws.onopen = () => { setStatus('live'); while ( queue.length ) ws.send(queue.shift()); };
		ws.onclose = () => { setStatus('down'); setTimeout(open, 1000); };
		ws.onerror = () => { try { ws.close(); } catch ( e ) {} };
		ws.onmessage = ( ev ) => {
			let m; try { m = JSON.parse(ev.data); } catch ( e ) { return; }
			if ( m.id != null && pending.has(m.id) ) {
				const { resolve, reject } = pending.get(m.id);
				pending.delete(m.id);
				m.ok ? resolve(m.result) : reject(new Error(m.error));
			} else if ( m.type ) {
				onEvent(m);
			}
		};
	}
	open();

	return {
		onStatus( cb ) { statusCb = cb; },
		call( op, args, sessionId ) {
			const id = 'r' + (++nextId);
			const payload = JSON.stringify({ id, op, args: args || {}, sessionId });
			return new Promise(( resolve, reject ) => {
				pending.set(id, { resolve, reject });
				if ( ws && ws.readyState === WebSocket.OPEN ) ws.send(payload);
				else queue.push(payload);
			});
		}
	};
}
