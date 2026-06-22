import { getAuth, clerkClient } from "@clerk/express";

// Require any signed-in Clerk user. Attaches req.userId.
export function requireAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Sign in required" });
  req.userId = userId;
  next();
}

// Require a signed-in user whose Clerk publicMetadata.role === "admin".
// Set this in the Clerk dashboard for your own user.
export async function requireAdmin(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Sign in required" });
  try {
    const user = await clerkClient.users.getUser(userId);
    if (user.publicMetadata?.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }
    req.userId = userId;
    req.clerkUser = user;
    next();
  } catch (e) {
    next(e);
  }
}

// Fetch the full Clerk user (for phone/email). Use after requireAuth.
export async function attachClerkUser(req, res, next) {
  try {
    if (req.userId && !req.clerkUser) {
      req.clerkUser = await clerkClient.users.getUser(req.userId);
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function primaryPhone(user) {
  const id = user?.primaryPhoneNumberId;
  const p =
    user?.phoneNumbers?.find((x) => x.id === id) || user?.phoneNumbers?.[0];
  return p?.phoneNumber || null;
}

export function primaryEmail(user) {
  const id = user?.primaryEmailAddressId;
  const e =
    user?.emailAddresses?.find((x) => x.id === id) ||
    user?.emailAddresses?.[0];
  return e?.emailAddress || null;
}
