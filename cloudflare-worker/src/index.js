/**
 * Petaluma Wrestling Club — contact form Worker.
 *
 * Accepts POST { name, email, message, website, turnstileToken } as JSON
 * from the static site's contact form, verifies the Turnstile token,
 * validates the fields, rejects honeypot hits, and emails the submission
 * via Resend. Returns { success: true } or { success: false, error }.
 */

// ---------------------------------------------------------------------
// CORS allowlist. Only requests whose Origin header exactly matches one
// of these are allowed to receive a response the browser will accept.
//
// Update this once the custom domain is live: add "https://petalumawc.com"
// (and "https://www.petalumawc.com" if that's used too). You can leave the
// github.io entry in place during the DNS cutover and remove it afterward,
// or remove it immediately — your call.
// ---------------------------------------------------------------------
const ALLOWED_ORIGINS = [
	"https://zachbabel.github.io",
	// "https://petalumawc.com", // TODO: uncomment once custom domain DNS is live
	// "https://www.petalumawc.com", // TODO: uncomment if the www subdomain is also used
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LEN = { name: 200, email: 320, message: 5000 };

function corsHeaders(origin) {
	const headers = {
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Vary": "Origin",
	};
	if (origin && ALLOWED_ORIGINS.includes(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
	}
	return headers;
}

function jsonResponse(body, status, origin) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(origin),
		},
	});
}

function validate(data) {
	const name = typeof data.name === "string" ? data.name.trim() : "";
	const email = typeof data.email === "string" ? data.email.trim() : "";
	const message = typeof data.message === "string" ? data.message.trim() : "";

	if (!name || name.length > MAX_LEN.name) {
		return { error: "Please enter your name." };
	}
	if (!email || email.length > MAX_LEN.email || !EMAIL_RE.test(email)) {
		return { error: "Please enter a valid email address." };
	}
	if (!message || message.length > MAX_LEN.message) {
		return { error: "Please enter a message." };
	}
	return { value: { name, email, message } };
}

async function sendEmail(env, { name, email, message }) {
	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: env.FROM_EMAIL,
			to: env.TO_EMAIL,
			reply_to: email,
			subject: `PWC website message from ${name}`,
			text: `From: ${name} <${email}>\n\n${message}`,
			html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`,
		}),
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`Resend API error (${res.status}): ${detail}`);
	}
}

// Verifies a Turnstile token with Cloudflare's siteverify endpoint. This is
// the actual bot gate: unlike the CORS Origin check (which any scripted
// request can spoof), a valid token can only be produced by Turnstile's own
// client-side challenge running in a real browser against our site key.
async function verifyTurnstile(env, token, remoteIp) {
	if (!token) return false;

	const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			secret: env.TURNSTILE_SECRET_KEY,
			response: token,
			remoteip: remoteIp,
		}),
	});

	const data = await res.json().catch(() => ({ success: false }));
	return data.success === true;
}

function escapeHtml(str) {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export default {
	async fetch(request, env) {
		const origin = request.headers.get("Origin");

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders(origin) });
		}

		if (request.method !== "POST") {
			return jsonResponse({ success: false, error: "Method not allowed." }, 405, origin);
		}

		// Reject requests from origins that aren't on the allowlist. The CORS
		// headers alone don't block the request from reaching the Worker (a
		// browser only enforces CORS on reading the response, and non-browser
		// clients ignore it entirely) — this check is the actual gate.
		if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
			return jsonResponse({ success: false, error: "Origin not allowed." }, 403, origin);
		}

		let data;
		try {
			data = await request.json();
		} catch {
			return jsonResponse({ success: false, error: "Invalid request body." }, 400, origin);
		}

		const turnstileOk = await verifyTurnstile(
			env,
			typeof data.turnstileToken === "string" ? data.turnstileToken : "",
			request.headers.get("CF-Connecting-IP")
		);
		if (!turnstileOk) {
			return jsonResponse({ success: false, error: "Verification failed. Please try again." }, 403, origin);
		}

		// Honeypot check: real visitors never see or fill this field in.
		// Pretend success so bots don't learn to look for a different tell.
		if (typeof data.website === "string" && data.website.trim() !== "") {
			return jsonResponse({ success: true }, 200, origin);
		}

		const { value, error } = validate(data);
		if (error) {
			return jsonResponse({ success: false, error }, 400, origin);
		}

		try {
			await sendEmail(env, value);
		} catch (err) {
			console.error(err);
			return jsonResponse(
				{ success: false, error: "Couldn't send your message right now. Please try again shortly." },
				502,
				origin
			);
		}

		return jsonResponse({ success: true }, 200, origin);
	},
};
