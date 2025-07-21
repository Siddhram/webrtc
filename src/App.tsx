import { useRef, useState } from 'react';
import { collection, doc, setDoc, getDoc, onSnapshot, updateDoc, addDoc } from 'firebase/firestore';
import { db } from './firebase';
import './App.css';

function App() {
  const [roomId, setRoomId] = useState('');
  const [inRoom, setInRoom] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [micOn, setMicOn] = useState(true);
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

  // Toggle microphone
  const toggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        setMicOn(track.enabled);
      });
    }
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
    <div className="App" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #232526 0%, #414345 100%)' }}>
      <h2 style={{ color: '#fff', marginBottom: 24 }}>Two-Person Video Call</h2>
      {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
      {status && <div style={{ color: 'lightgreen', marginBottom: 8 }}>{status}</div>}
      {!inRoom ? (
        <div style={{ background: '#333', padding: 24, borderRadius: 12, boxShadow: '0 2px 16px #0006', minWidth: 320 }}>
          <button style={{ marginBottom: 16, width: '100%' }} onClick={createRoom}>Create Room</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              placeholder="Enter Room ID"
              style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #555', background: '#222', color: '#fff' }}
            />
            <button onClick={joinRoom} disabled={!roomId} style={{ padding: '8px 16px' }}>Join Room</button>
          </div>
        </div>
      ) : (
        <div style={{ background: '#222', padding: 24, borderRadius: 12, boxShadow: '0 2px 16px #0006', minWidth: 340 }}>
          <p style={{ color: '#fff', marginBottom: 16 }}>Room ID: <span style={{ color: '#90caf9' }}>{roomId}</span></p>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <video ref={localVideoRef} autoPlay playsInline muted width={260} height={180} style={{ borderRadius: 10, border: '2px solid #90caf9', background: '#111' }} />
              <span style={{ color: '#90caf9', marginTop: 6, fontSize: 14 }}>You</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <video ref={remoteVideoRef} autoPlay playsInline width={260} height={180} style={{ borderRadius: 10, border: '2px solid #f48fb1', background: '#111' }} />
              <span style={{ color: '#f48fb1', marginTop: 6, fontSize: 14 }}>Remote</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
            <button onClick={toggleMic} style={{ background: micOn ? '#43a047' : '#b71c1c', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              {micOn ? (
                <span role="img" aria-label="Mic On">🎤</span>
              ) : (
                <span role="img" aria-label="Mic Off">🔇</span>
              )}
              {micOn ? 'Mic On' : 'Mic Off'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
