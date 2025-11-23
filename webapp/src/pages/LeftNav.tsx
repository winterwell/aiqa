import React from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { Nav, NavItem, NavLink } from 'reactstrap';

const LeftNav: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const location = useLocation();

  if (!organisationId) {
    return null;
  }

  const navItems = [
    {
      label: 'Organisation',
      path: `/organisation/${organisationId}`,
    },
    {
      label: 'Traces',
      path: `/organisation/${organisationId}/traces`,
    },
    {
      label: 'Datasets',
      path: `/organisation/${organisationId}/dataset`,
    },
    {
      label: 'Experiments',
      path: `/organisation/${organisationId}/experiments`,
    },
  ];

  const isActive = (path: string) => {
    if (path === `/organisation/${organisationId}`) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <Nav vertical className="p-3 border-end" style={{ minHeight: 'calc(100vh - 56px)', backgroundColor: '#f8f9fa' }}>
      {navItems.map((item) => (
        <NavItem key={item.path}>
          <NavLink
            tag={Link}
            to={item.path}
            active={isActive(item.path)}
            className="mb-2"
            style={{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '8px 12px',
            }}
          >
            {item.label}
          </NavLink>
        </NavItem>
      ))}
    </Nav>
  );
};

export default LeftNav;

