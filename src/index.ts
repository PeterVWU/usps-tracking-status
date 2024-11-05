/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
	STATUS_DB: D1Database;
}

// Define types for our database rows
interface TrackingNumber {
	tracking_number: string;
	order_number: string | null;
	status: string;
	created_at: string;
	updated_at: string;
}

interface ShipmentData {
	trackingNumber: string;
	carrierCode: string;
	orderNumber: string;
}


interface StatusUpdate {
	tracking_number: string;
	status: string;
}

// CORS headers configuration
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*', // You should restrict this to your domain in production
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	'Access-Control-Max-Age': '86400', // 24 hours
};
// Handle CORS preflight requests
function handleOptions(request: Request) {
	return new Response(null, {
		headers: CORS_HEADERS
	});
}

export default {
	// Handle incoming requests
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {

		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return handleOptions(request);
		}


		const url = new URL(request.url);

		// Route for getting tracking URLs to process
		if (url.pathname === '/tracking-urls') {
			return await handleGetTrackingUrls(env);
		}

		// Route for receiving status updates
		if (url.pathname === '/tracking-status' && request.method === 'POST') {
			return await handleStatusUpdates(request, env);
		}

		// Add a test endpoint for scheduled job
		if (url.pathname === '/test-scheduled') {
			const shipments = await fetchNewShipments(env);
			await storeNewTrackingNumbers(shipments, env.STATUS_DB);
			return Response.json({ shipments });
		}

		return new Response('Not found', { status: 404 });
	},
	// Scheduled task to fetch from ShipStation
	async scheduled(controller, env, ctx) {
		console.log('schedule starts')
		try {
			const shipments = await fetchNewShipments(env);
			await storeNewTrackingNumbers(shipments, env.STATUS_DB);
		} catch (error) {
			console.error('Scheduled task error:', error);
		}
	}
} satisfies ExportedHandler<Env>;


async function handleGetTrackingUrls(env: Env) {
	try {
		// Get tracking numbers that are not delivered
		const result = await env.STATUS_DB.prepare(`
			SELECT tracking_number 
			FROM tracking_numbers 
			WHERE status != 'Delivered'
			LIMIT 300
		`).all<TrackingNumber>();

		const trackingNumbers = result.results.map(row => row.tracking_number);

		// Generate URLs (30 tracking numbers per URL)
		const urls = [];
		for (let i = 0; i < trackingNumbers.length; i += 30) {
			const chunk = trackingNumbers.slice(i, i + 30);
			urls.push('https://tools.usps.com/go/TrackConfirmAction.action?tLabels=' +
				chunk.join('%2C'));
		}

		return Response.json({
			urls,
		}, {
			headers: {
				...CORS_HEADERS,
				'Content-Type': 'application/json'
			}
		});
	} catch (error) {
		return Response.json({ error: 'Failed to get tracking URLs' }, { status: 500 });
	}
}

async function handleStatusUpdates(request: Request, env: Env) {
	try {
		const updates: StatusUpdate[] = await request.json();

		// Prepare statement for updating status
		const stmt = await env.STATUS_DB.prepare(`
		UPDATE tracking_numbers 
		SET status = ?, 
			updated_at = datetime('now') 
		WHERE tracking_number = ?
	  `);

		// Using batch operation for better performance
		const batch = updates.map(update =>
			stmt.bind(update.status, update.tracking_number)
		);

		await env.STATUS_DB.batch(batch);

		return Response.json({ success: true }, {
			headers: {
				...CORS_HEADERS,
				'Content-Type': 'application/json'
			}
		});
	} catch (error) {
		return Response.json({ error: 'Failed to update statuses' }, { status: 500 });
	}
}

async function fetchNewShipments(env: Env): Promise<ShipmentData[]> {
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	const dateStr = yesterday.toISOString().split('T')[0];
	console.log('shipstation url', `https://shipstation-proxy.info-ba2.workers.dev/shipments?shipDateStart=${dateStr}`)
	const response = await fetch(
		`https://shipstation-proxy.info-ba2.workers.dev/shipments?shipDateStart=${dateStr}`
	);
	console.log('shipstation response', response)
	const data = await response.json();
	return (data as any).shipments.map((shipment: any) => ({
		trackingNumber: shipment.trackingNumber,
		orderNumber: shipment.orderNumber
	}));
}

async function storeNewTrackingNumbers(shipments: ShipmentData[], db: D1Database) {
	if (shipments.length === 0) return;

	const stmt = await db.prepare(`
	  INSERT INTO tracking_numbers (tracking_number, order_number, status, created_at) 
	  VALUES (?, ?, 'pending', datetime('now'))
	  ON CONFLICT(tracking_number) DO NOTHING
	`);

	// Using batch operation for better performance
	const batch = shipments.map(shipment =>
		stmt.bind(shipment.trackingNumber, shipment.orderNumber)
	);

	await db.batch(batch);
}
