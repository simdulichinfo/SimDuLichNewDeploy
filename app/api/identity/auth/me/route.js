import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse } from '../../../../../lib/apiAuth';

export async function GET(request) {
  try {
    const { user } = await authenticate(request);
    return NextResponse.json(user);
  } catch (error) {
    return authErrorResponse(error);
  }
}
