import { Link } from 'react-router-dom';

export default function LinkId({to, id, name}: {to: string, id: string, name?: string}) {
    return <Link to={to} style={{ maxWidth: '10rem', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-all' }}>{name || id}</Link>;
}