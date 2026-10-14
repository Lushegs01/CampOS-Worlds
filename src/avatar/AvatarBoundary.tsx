import { Component, useEffect, useRef, type ReactNode } from 'react';
import type * as THREE from 'three';
import { registerMovingCaster } from '../world/shadows';

/**
 * One player's character failing to load (a dropped download on a phone) must not take the whole
 * campus down with it: show a plain stand-in figure where they are and try again a little later.
 * Failed downloads are not cached (world/assets.ts), so each retry fetches the model again.
 */
export class AvatarBoundary extends Component<{ children: ReactNode; accent?: string }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  private timer?: ReturnType<typeof setTimeout>;
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    console.warn('A character could not be loaded; showing a stand-in.', error);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setState(s => ({ failed: false, attempt: s.attempt + 1 })), Math.min(60000, 8000 * 2 ** this.state.attempt));
  }
  componentWillUnmount() { clearTimeout(this.timer); }
  render() { return this.state.failed ? <StandIn accent={this.props.accent} /> : this.props.children; }
}

function StandIn({ accent = '#537d70' }: { accent?: string }) {
  const group = useRef<THREE.Group>(null!);
  useEffect(() => registerMovingCaster(group.current), []);
  return <group ref={group} name="avatar-stand-in">
    <mesh position-y={.86} castShadow><capsuleGeometry args={[.21, 1.05, 4, 10]} /><meshStandardMaterial color={accent} roughness={.8} /></mesh>
    <mesh position-y={1.68} castShadow><sphereGeometry args={[.13, 14, 10]} /><meshStandardMaterial color="#8a6a52" roughness={.7} /></mesh>
  </group>;
}
