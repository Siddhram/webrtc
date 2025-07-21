import { useRef, useState } from 'react';
import { collection, doc, setDoc, getDoc, onSnapshot, updateDoc, addDoc } from 'firebase/firestore';
import { db } from './firebase';
import './App.css';

function App() {
  const [roomId, setRoomId] = useState('');
  const [inRoom, setInRoom] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ICE servers for STUN
  const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  // Create a new room
  const createRoom = async () => {
    setError('');
    setStatus('Creating room...');
    try {
      const pc = new RTCPeerConnection(servers);
      pcRef.current = pc;
      await setupLocalStream();
      addLocalTracksToPC(pc);
      const roomRef = await addDoc(collection(db, 'rooms'), {});
      setRoomId(roomRef.id);
      setInRoom(true);
      setStatus('Room created. Waiting for other user to join...');
      await setupSignaling(pc, roomRef.id, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError('Failed to create room: ' + message);
      setStatus('');
      console.error('Create room error:', err);
    }
  };

  // Join an existing room
  const joinRoom = async () => {
    setError('');
    setStatus('Joining room...');
    try {
      const pc = new RTCPeerConnection(servers);
      pcRef.current = pc;
      await setupLocalStream();
      addLocalTracksToPC(pc);
      setInRoom(true);
      await setupSignaling(pc, roomId, false);
      setStatus('Joined room. Connecting...');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError('Failed to join room: ' + message);
      setStatus('');
      console.error('Join room error:', err);
    }
  };

  // Get local media stream
  const setupLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setStatus('Local media stream acquired.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError('Could not get local media: ' + message);
      setStatus('');
      throw err;
    }
  };

  // Add local tracks to peer connection
  const addLocalTracksToPC = (pc: RTCPeerConnection) => {
    localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
  };

  // Setup signaling logic
  const setupSignaling = async (pc: RTCPeerConnection, roomId: string, isCaller: boolean) => {
    setStatus('Setting up signaling...');
    const roomRef = doc(db, 'rooms', roomId);
    const offerCandidates = collection(roomRef, 'offerCandidates');
    const answerCandidates = collection(roomRef, 'answerCandidates');

    // Listen for remote ICE candidates
    onSnapshot(isCaller ? answerCandidates : offerCandidates, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          console.log('Remote ICE candidate:', data);
          pc.addIceCandidate(new RTCIceCandidate(data)).catch(e => console.error('Error adding ICE candidate', e));
        }
      });
    });

    // Add local ICE candidates to Firestore
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        try {
          await addDoc(isCaller ? offerCandidates : answerCandidates, event.candidate.toJSON());
          console.log('Local ICE candidate added:', event.candidate);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setError('Failed to add ICE candidate: ' + message);
          console.error('Add ICE candidate error:', err);
        }
      }
    };

    // Set up remote stream
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setStatus('Remote stream received.');
      }
    };

    if (isCaller) {
      // Caller creates offer
      setStatus('Creating offer...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await setDoc(roomRef, { offer });
      setStatus('Waiting for answer...');
      // Listen for answer
      onSnapshot(roomRef, (snapshot) => {
        const data = snapshot.data();
        if (data?.answer && !pc.currentRemoteDescription) {
          pc.setRemoteDescription(new RTCSessionDescription(data.answer)).then(() => {
            setStatus('Connected!');
          });
        }
      });
    } else {
      // Callee gets offer, creates answer
      setStatus('Fetching room info...');
      const roomSnap = await getDoc(roomRef);
      const data = roomSnap.data();
      if (!data) {
        setError('Room not found. Please check the Room ID.');
        setStatus('');
        return;
      }
      if (!data.offer) {
        setError('No offer found in this room. Wait for the other user to create the room.');
        setStatus('');
        return;
      }
      setStatus('Setting remote description...');
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      setStatus('Creating answer...');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await updateDoc(roomRef, { answer });
      setStatus('Answer sent. Waiting for connection...');
    }
  };

  return (
    <div className="App" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(135deg, #e0e7ff 0%, #f8fafc 100%)' }}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: 32, minWidth: 350, maxWidth: 420, margin: 24 }}>
        <h2 style={{ marginBottom: 24, color: '#3b82f6', letterSpacing: 1 }}>Two-Person Video Call</h2>
        {error && <div style={{ color: '#ef4444', marginBottom: 8, fontWeight: 500 }}>{error}</div>}
        {status && <div style={{ color: '#22c55e', marginBottom: 8, fontWeight: 500 }}>{status}</div>}
        {!inRoom ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button style={{ background: '#3b82f6', color: '#fff', fontWeight: 600, border: 'none', borderRadius: 8, padding: '12px 0', fontSize: 18, marginBottom: 8 }} onClick={createRoom}>Create Room</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                placeholder="Enter Room ID"
                style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16 }}
              />
              <button style={{ background: '#6366f1', color: '#fff', fontWeight: 600, border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 16 }} onClick={joinRoom} disabled={!roomId}>Join</button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 12, fontSize: 15, color: '#64748b' }}>Room ID: <span style={{ fontWeight: 600, color: '#3b82f6' }}>{roomId}</span></div>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', alignItems: 'center', marginTop: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <video ref={localVideoRef} autoPlay playsInline muted width={260} height={180} style={{ borderRadius: 12, border: '2px solid #3b82f6', background: '#e0e7ff', marginBottom: 6, boxShadow: '0 2px 8px rgba(59,130,246,0.08)' }} />
                <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>You</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <video ref={remoteVideoRef} autoPlay playsInline width={260} height={180} style={{ borderRadius: 12, border: '2px solid #6366f1', background: '#f1f5f9', marginBottom: 6, boxShadow: '0 2px 8px rgba(99,102,241,0.08)' }} />
                <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>Remote</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ color: '#64748b', fontSize: 13, marginTop: 12, opacity: 0.7 }}>Powered by WebRTC & Firebase</div>
    </div>
  );
}

export default App;
