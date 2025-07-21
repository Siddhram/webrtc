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

  // ICE servers for STUN and TURN (TURN is required for internet/NAT traversal)
  const servers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:relay.metered.ca:80',
        username: 'openai',
        credential: 'openai'
      }
      // For production, use your own TURN server or a paid service
    ]
  };

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
          console.log('Remote ICE candidate received:', data);
          pc.addIceCandidate(new RTCIceCandidate(data)).then(() => {
            console.log('Remote ICE candidate added to connection');
          }).catch(e => console.error('Error adding ICE candidate', e));
        }
      });
    });

    // Add local ICE candidates to Firestore
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        try {
          await addDoc(isCaller ? offerCandidates : answerCandidates, event.candidate.toJSON());
          console.log('Local ICE candidate sent to Firestore:', event.candidate);
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
    // TODO: Clean up signaling data (room and candidate collections) after the call ends.
  };

  return (
    <div className="App" style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #e0e7ff 0%, #f0fdfa 100%)', padding: 0 }}>
      <header style={{ padding: '2rem 0 1rem 0', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', margin: 0, color: '#3b82f6', letterSpacing: 1 }}>WebRTC Video Call</h1>
        <p style={{ color: '#64748b', marginTop: 8 }}>Connect with a friend using Room ID</p>
      </header>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {error && <div style={{ color: 'red', marginBottom: 8, fontWeight: 500 }}>{error}</div>}
        {status && <div style={{ color: 'green', marginBottom: 8 }}>{status}</div>}
        {!inRoom ? (
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 16px #0001', padding: 32 }}>
            <button style={{ width: '100%', marginBottom: 16, background: '#3b82f6', color: '#fff', fontWeight: 600, fontSize: 18 }} onClick={createRoom}>Create Room</button>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                placeholder="Enter Room ID"
                style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 16 }}
              />
              <button style={{ background: '#10b981', color: '#fff', fontWeight: 600, borderRadius: 8, padding: '10px 18px', fontSize: 16 }} onClick={joinRoom} disabled={!roomId}>Join</button>
            </div>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 16px #0001', padding: 32 }}>
            <div style={{ marginBottom: 16, color: '#3b82f6', fontWeight: 600 }}>Room ID: <span style={{ color: '#0f172a' }}>{roomId}</span></div>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <video ref={localVideoRef} autoPlay playsInline muted width={240} height={180} style={{ borderRadius: 12, border: '3px solid #3b82f6', background: '#e0e7ff' }} />
                <span style={{ marginTop: 8, color: '#3b82f6', fontWeight: 500 }}>You</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <video ref={remoteVideoRef} autoPlay playsInline width={240} height={180} style={{ borderRadius: 12, border: '3px solid #10b981', background: '#f0fdfa' }} />
                <span style={{ marginTop: 8, color: '#10b981', fontWeight: 500 }}>Friend</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
