import React, { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Navbar, Nav, NavItem, Dropdown, DropdownToggle, DropdownMenu, DropdownItem, NavLink } from 'reactstrap';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import AvatarBadge from '../components/AvatarBadge';
import { getOrganisation } from '../api';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

const TopNav: React.FC = () => {
  const { user, logout, isAuthenticated } = useAuth0();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const toggle = () => setDropdownOpen((prevState) => !prevState);

  if (!isAuthenticated) {
    return null;
  }
  // organisation from url /organisation/{organisation}
  // work directly on window.location.pathname
  const pathBits = window.location.pathname.split('/');
  const orgIndex = pathBits.indexOf('organisation');  
  const organisationId = orgIndex !== -1 ? pathBits[orgIndex + 1] : null;
  console.log('organisationId', organisationId);

  const {data: organisation} = useQuery({
    queryKey: ['organisation', organisationId],
    queryFn: () => getOrganisation(organisationId),
    enabled: !!organisationId,
  });

  console.log('organisation', organisation);

  return (
    <Navbar color="light" light expand="md" className="border-bottom top-nav-compact">
      <div className="container-fluid d-flex align-items-center">
		<NavLink href="/" target="_blank" rel="noopener">
		<Logo size={28} showText={true} />
		</NavLink>
        <Nav className="ms-auto" navbar>
			<NavItem>
				<NavLink href={`/organisation/${organisationId}`}>
					{organisation?.name}
				</NavLink>
			</NavItem>
          <NavItem>
            <Dropdown isOpen={dropdownOpen} toggle={toggle}>
              <DropdownToggle caret nav>
                <AvatarBadge
                  picture={user?.picture}
                  name={user?.name}
                  email={user?.email}
                />
              </DropdownToggle>
              <DropdownMenu end>
                <DropdownItem header>
                  {user?.email}
                </DropdownItem>
                <DropdownItem divider />
                <DropdownItem tag={Link} to="/profile">
                  Profile
                </DropdownItem>
                {organisationId && (
                  <DropdownItem tag={Link} to={`/organisation/${organisationId}/account`}>
                    Account
                  </DropdownItem>
                )}
                <DropdownItem tag={Link} to="/about">
                  About this App
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

