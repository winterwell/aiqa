import { useState, useEffect } from 'react';


export default function MyPlaylist() {

    const [data, setData] = useState([]);
    useEffect(() => {
        fetch('https://api.spotify.com/v1/me/playlists')
        .then(response => response.json())
        .then(data => setData(data));
    }, []);

    return <>
    <h1>My Playlist</h1>
    <ul>
        {data.map((item) => (
            <li key={item.id}>{item.name}</li>
        ))}
    </ul>
    </>;
}

