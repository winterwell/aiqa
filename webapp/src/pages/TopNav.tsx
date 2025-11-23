import React, { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Navbar, Nav, NavItem, Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import Logo from '../components/Logo';

const TopNav: React.FC = () => {
  const { user, logout, isAuthenticated } = useAuth0();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const toggle = () => setDropdownOpen((prevState) => !prevState);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Navbar color="light" light expand="md" className="border-bottom">
      <div className="container-fluid">
        <Logo size={32} showText={true} />
        <Nav className="ms-auto" navbar>
          <NavItem>
            <Dropdown isOpen={dropdownOpen} toggle={toggle}>
              <DropdownToggle caret nav>
                <span className="d-inline-flex align-items-center">
                  {user?.picture && (
                    <img
                      src={user.picture}
                      alt={user.name || 'Profile'}
                      className="rounded-circle me-2"
                      style={{ width: '32px', height: '32px' }}
                    />
                  )}
                  <span>{user?.name || user?.email || 'Profile'}</span>
                </span>
              </DropdownToggle>
              <DropdownMenu end>
                <DropdownItem header>
                  {user?.email}
                </DropdownItem>
                <DropdownItem divider />
                <DropdownItem
                  onClick={() =>
                    logout({
                      logoutParams: {
                        returnTo: window.location.origin,
                      },
                    })
                  }
                >
                  Logout
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </NavItem>
        </Nav>
      </div>
    </Navbar>
  );
};

export default TopNav;

