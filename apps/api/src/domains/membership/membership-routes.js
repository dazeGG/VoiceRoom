'use strict';

function send(reply, statusCode, payload) {
  if (reply && typeof reply.code === 'function') return reply.code(statusCode).send(payload);
  if (reply && typeof reply.status === 'function') return reply.status(statusCode).send(payload);
  throw new TypeError('Unsupported route reply');
}

function registerMembershipRoutes({
  app,
  completeAdmission,
  directoryService,
  membershipService,
  prepareLeave,
  resolveUser,
  membershipEnabled = () => true
} = {}) {
  if (!app || typeof app.get !== 'function' || typeof resolveUser !== 'function') {
    throw new TypeError('app and resolveUser are required');
  }

  app.get('/api/rooms/:roomId/members', async (request, reply) => {
    if (!await membershipEnabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
    const session = await resolveUser(request);
    const user = session?.user || session;
    if (!user?.id) return send(reply, 401, { ok: false, error: 'Authentication required' });
    try {
      const result = await directoryService.list({
        roomId: request.params?.roomId,
        viewerUserId: user.id,
        cursor: request.query?.cursor,
        limit: request.query?.limit,
        query: request.query?.q ?? request.query?.query
      });
      if (result.status === 'forbidden') return send(reply, 403, { ok: false, error: 'Membership required' });
      if (result.status !== 'ok') return send(reply, 401, { ok: false, error: 'Authentication required' });
      return send(reply, 200, result.envelope);
    } catch (error) {
      if (error?.code === 'invalid_cursor') return send(reply, 400, { ok: false, error: 'Invalid cursor' });
      throw error;
    }
  });

  if (typeof app.post === 'function' && membershipService && typeof completeAdmission === 'function') {
    app.post('/api/rooms/:roomId/memberships', async (request, reply) => {
      if (!await membershipEnabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
      const session = await resolveUser(request);
      const user = session?.user || session;
      if (!user?.id) return send(reply, 401, { ok: false, error: 'Authentication required' });
      const result = await membershipService.admitRegistered({
        roomId: request.params?.roomId,
        userId: user.id,
        ip: request.ip || '',
        completeAdmission: () => completeAdmission({ request, roomId: request.params?.roomId, user })
      });
      if (result.status === 'banned') return send(reply, 403, { ok: false, error: 'Room access denied' });
      if (result.status === 'not_found') return send(reply, 404, { ok: false, error: 'Room not found' });
      if (result.status !== 'active') return send(reply, 409, { ok: false, error: 'Admission not completed' });
      return send(reply, 200, { ok: true, admission: result.admission, membership: result.membership });
    });
  }

  if (typeof app.delete === 'function' && membershipService?.leaveRoom) {
    app.delete('/api/rooms/:roomId/memberships/me', async (request, reply) => {
      if (!await membershipEnabled(request)) return send(reply, 404, { ok: false, error: 'Not found' });
      const session = await resolveUser(request);
      const user = session?.user || session;
      if (!user?.id) return send(reply, 401, { ok: false, error: 'Authentication required' });
      const roomId = request.params?.roomId;
      const membership = await membershipService.getMembership(roomId, user.id);
      if (membership?.role === 'owner') {
        return send(reply, 409, { ok: false, code: 'room_owner_cannot_leave', error: 'Room owner cannot leave their room' });
      }
      if (typeof prepareLeave === 'function') {
        const prepared = await prepareLeave({ request, roomId, user });
        if (prepared === false || prepared?.ok === false) {
          return send(reply, 503, { ok: false, code: prepared?.code || 'leave_unavailable', error: 'Unable to revoke room access' });
        }
      }
      const result = await membershipService.leaveRoom({ roomId, userId: user.id });
      if (result.status === 'owner_required') {
        return send(reply, 409, { ok: false, code: 'room_owner_cannot_leave', error: 'Room owner cannot leave their room' });
      }
      if (result.status !== 'left' && result.status !== 'not_active') {
        return send(reply, 409, { ok: false, code: 'room_leave_failed', error: 'Unable to leave room' });
      }
      return send(reply, 200, { ok: true, left: result.status === 'left' });
    });
  }
}

module.exports = { registerMembershipRoutes };
