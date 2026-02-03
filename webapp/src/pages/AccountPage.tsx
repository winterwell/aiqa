import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
	Container,
	Row,
	Col,
	Card,
	CardBody,
	CardHeader,
	ListGroup,
	ListGroupItem,
	Badge,
	Alert,
	Button,
	Modal,
	ModalHeader,
	ModalBody,
	ModalFooter,
	FormGroup,
	Label,
	Input,
} from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth0 } from '@auth0/auth0-react';
import { getOrganisation, getOrganisationAccount, updateSubscription, createCheckoutSession, listOrganisations, getOrCreateUser } from '../api';
import subscriptionsConfig from '../subscriptions.json';

type SubscriptionPackage = 'free' | 'pro' | 'enterprise';

const AccountPage: React.FC = () => {
	const { organisationId } = useParams<{ organisationId: string }>();
	const { user: auth0User } = useAuth0();
	const queryClient = useQueryClient();
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [selectedPlan, setSelectedPlan] = useState<SubscriptionPackage>('free');
	const [noPaymentNeeded, setNoPaymentNeeded] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);

	const { data: organisation, isLoading, error } = useQuery({
		queryKey: ['organisation', organisationId],
		queryFn: () => getOrganisation(organisationId!),
		enabled: !!organisationId,
	});

	const { data: account, isLoading: isLoadingAccount } = useQuery({
		queryKey: ['organisationAccount', organisationId],
		queryFn: () => getOrganisationAccount(organisationId!),
		enabled: !!organisationId,
	});

	// Check if user is super admin
	const { data: dbUser } = useQuery({
		queryKey: ['user', auth0User?.email],
		queryFn: async () => {
			if (!auth0User?.email) return null;
			return getOrCreateUser(auth0User.email, auth0User.name || auth0User.email);
		},
		enabled: !!auth0User?.email,
	});

	const { data: allOrganisations } = useQuery({
		queryKey: ['organisations'],
		queryFn: () => listOrganisations(),
		enabled: !!dbUser?.id,
	});

	const isSuperAdmin = allOrganisations?.some(org => org.name === 'AIQA') || false;

	const subscriptionPackage: SubscriptionPackage = (account?.subscription?.type as SubscriptionPackage) || 'free';

	// Get subscription plan defaults
	const getSubscriptionDefault = (key: 'rate_limit_per_hour' | 'retention_period_days'): number | undefined => {
		const planConfig = subscriptionsConfig[subscriptionPackage];
		if (planConfig && key in planConfig) {
			const value = planConfig[key as keyof typeof planConfig];
			return typeof value === 'number' ? value : undefined;
		}
		// Enterprise fallback defaults (not in webapp subscriptions.json)
		if (subscriptionPackage === 'enterprise') {
			return key === 'rate_limit_per_hour' ? 10000 : 365;
		}
		return undefined;
	};

	const getSubscriptionBadgeColor = (pkg: SubscriptionPackage | null) => {
		if (!pkg) {
			return 'secondary';
		}
		switch (pkg) {
			case 'free':
				return 'info';
			case 'pro':
				return 'primary';
			case 'enterprise':
				return 'success';
			default:
				return 'secondary';
		}
	};

	const getSubscriptionDescription = (pkg: SubscriptionPackage | null) => {
		if (!pkg) {
			return '';
		}
		switch (pkg) {
			case 'free':
				return 'You are on the Free plan. Upgrade to Pro or Enterprise for more features.';
			case 'pro':
				return 'You are on the Pro plan. Upgrade to Enterprise for advanced features.';
			case 'enterprise':
				return 'You are on the Enterprise plan with full access to all features.';
			default:
				return '';
		}
	};

	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const updateSubscriptionMutation = useMutation({
		mutationFn: async ({ planType, noPayment }: { planType: SubscriptionPackage; noPayment: boolean }) => {
			return updateSubscription(organisationId!, planType, isSuperAdmin && noPayment, undefined);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['organisationAccount', organisationId] });
			setIsModalOpen(false);
			setIsProcessing(false);
			setErrorMessage(null);
		},
		onError: (error: any) => {
			setErrorMessage(error?.message || 'Failed to update subscription. Please try again.');
			setIsProcessing(false);
		},
	});

	const createCheckoutMutation = useMutation({
		mutationFn: async (planType: SubscriptionPackage) => {
			return createCheckoutSession(organisationId!, planType);
		},
		onSuccess: (data) => {
			if (data.checkoutUrl) {
				window.location.href = data.checkoutUrl;
			} else if (data.success) {
				// Free plan was set directly
				queryClient.invalidateQueries({ queryKey: ['organisationAccount', organisationId] });
				setIsModalOpen(false);
				setIsProcessing(false);
				setErrorMessage(null);
			}
		},
		onError: (error: any) => {
			setErrorMessage(error?.message || 'Failed to create checkout session. Please try again.');
			setIsProcessing(false);
		},
	});

	const handleChangeSubscription = async () => {
		setIsProcessing(true);
		setErrorMessage(null);

		const needsCheckout = selectedPlan === 'pro' && !noPaymentNeeded;
		if (needsCheckout) {
			createCheckoutMutation.mutate(selectedPlan);
		} else {
			updateSubscriptionMutation.mutate({ planType: selectedPlan, noPayment: noPaymentNeeded });
		}
	};

	const getButtonText = () => {
		if (isProcessing) return 'Processing...';
		if (selectedPlan === 'pro' && !noPaymentNeeded) return 'Continue to Payment';
		return 'Update Subscription';
	};

	if (isLoading || isLoadingAccount) {
		return (
			<Container>
				<div className="text-center">
					<div className="spinner-border" role="status">
						<span className="visually-hidden">Loading...</span>
					</div>
				</div>
			</Container>
		);
	}

	if (error || !organisation || !account) {
		return (
			<Container>
				<div className="alert alert-danger">
					<h4>Error</h4>
					<p>Failed to load account: {error instanceof Error ? error.message : 'Unknown error'}</p>
				</div>
			</Container>
		);
	}

	return (
		<Container className="mt-4">
			<Row>
				<Col>
					<h1>Account</h1>
				</Col>
			</Row>

			<Row className="mt-4">
				<Col md={6}>
					<Card className="mb-4">
						<CardHeader>
							<h5>Subscription</h5>
						</CardHeader>
						<CardBody>
							<div className="mb-3">
								<h6>
									Current Plan:{' '}
									<Badge color={getSubscriptionBadgeColor(subscriptionPackage)}>
										{subscriptionPackage ? subscriptionPackage.charAt(0).toUpperCase() + subscriptionPackage.slice(1) : 'Unknown'}
									</Badge>
								</h6>
								<p className="text-muted">{getSubscriptionDescription(subscriptionPackage)}</p>
								{account.subscription?.pricePerMonth !== undefined && account.subscription.pricePerMonth > 0 && (
									<p className="text-muted">
										Price: ${account.subscription.pricePerMonth.toFixed(2)}/{account.subscription.currency || 'USD'} per month
									</p>
								)}
							</div>
							<div className="d-flex gap-2">
								<Button color="primary" onClick={() => setIsModalOpen(true)}>
									Change Subscription
								</Button>
								<Button
									color="secondary"
									tag="a"
									href="https://billing.stripe.com/p/login/3cIdR2aPy2cw3lMbFg8ww00"
									target="_blank"
									rel="noopener noreferrer"
								>
									Billing & Invoices
								</Button>
							</div>
						</CardBody>
					</Card>

					<Card>
						<CardHeader>
							<h5>Organisation Details</h5>
						</CardHeader>
						<CardBody>
							<ListGroup flush>
								<ListGroupItem>
									<strong>Name:</strong> {organisation.name}
								</ListGroupItem>
								<ListGroupItem>
									<strong>Organisation ID:</strong> {organisation.id}
								</ListGroupItem>
								<ListGroupItem>
									<strong>Rate Limit:</strong>{' '}
									{(() => {
										const currentValue = account.rateLimitPerHour;
										const defaultValue = getSubscriptionDefault('rate_limit_per_hour');
										const displayValue = currentValue ?? defaultValue;
										const isCustom = currentValue !== undefined && currentValue !== null && defaultValue !== undefined && currentValue !== defaultValue;
										
										if (displayValue === undefined) {
											return 'Not set';
										}
										
										return (
											<>
												{displayValue} per hour
												{isCustom && defaultValue !== undefined && (
													<span className="text-muted ms-2">
														(custom: default is {defaultValue})
													</span>
												)}
											</>
										);
									})()}
								</ListGroupItem>
								<ListGroupItem>
									<strong>Retention Period:</strong>{' '}
									{(() => {
										const currentValue = account.retentionPeriodDays;
										const defaultValue = getSubscriptionDefault('retention_period_days');
										const displayValue = currentValue ?? defaultValue;
										const isCustom = currentValue !== undefined && currentValue !== null && defaultValue !== undefined && currentValue !== defaultValue;
										
										if (displayValue === undefined) {
											return 'Not set';
										}
										
										return (
											<>
												{displayValue} days
												{isCustom && defaultValue !== undefined && (
													<span className="text-muted ms-2">
														(custom: default is {defaultValue})
													</span>
												)}
											</>
										);
									})()}
								</ListGroupItem>
								<ListGroupItem>
									<strong>Members:</strong> {organisation.members?.length || 0}
								</ListGroupItem>
								<ListGroupItem>
									<strong>Created:</strong> {new Date(organisation.created).toLocaleString()}
								</ListGroupItem>
								<ListGroupItem>
									<strong>Updated:</strong> {new Date(organisation.updated).toLocaleString()}
								</ListGroupItem>
							</ListGroup>
						</CardBody>
					</Card>
				</Col>
			</Row>

			<Modal isOpen={isModalOpen} toggle={() => !isProcessing && setIsModalOpen(false)}>
				<ModalHeader toggle={() => !isProcessing && setIsModalOpen(false)}>
					Change Subscription
				</ModalHeader>
				<ModalBody>
					{errorMessage && (
						<Alert color="danger" className="mb-3">
							{errorMessage}
						</Alert>
					)}
					<FormGroup>
						<Label>Select Plan</Label>
						<Input
							type="select"
							value={selectedPlan}
							onChange={(e) => {
								setSelectedPlan(e.target.value as SubscriptionPackage);
								setErrorMessage(null);
							}}
							disabled={isProcessing}
						>
							<option value="free">Free - $0/month</option>
							<option value="pro">Pro - $29/month</option>
							{isSuperAdmin && (
								<option value="enterprise">Enterprise - Custom pricing</option>
							)}
						</Input>
					</FormGroup>
					{selectedPlan === 'enterprise' && (
						<Alert color="warning" className="mt-3">
							<strong>Enterprise Plan:</strong> This plan requires manual setup by super-admin with custom pricing.
						</Alert>
					)}
					{isSuperAdmin && (
						<FormGroup check>
							<Label check>
								<Input
									type="checkbox"
									checked={noPaymentNeeded}
									onChange={(e) => {
										setNoPaymentNeeded(e.target.checked);
										setErrorMessage(null);
									}}
									disabled={isProcessing}
								/>
								{' '}No payment needed (Super Admin override)
							</Label>
						</FormGroup>
					)}
					{selectedPlan === 'pro' && !noPaymentNeeded && (
						<Alert color="info" className="mt-3">
							You will be redirected to Stripe to complete payment.
						</Alert>
					)}
				</ModalBody>
				<ModalFooter>
					<Button
						color="primary"
						onClick={handleChangeSubscription}
						disabled={isProcessing}
					>
						{getButtonText()}
					</Button>
					<Button
						color="secondary"
						onClick={() => setIsModalOpen(false)}
						disabled={isProcessing}
					>
						Cancel
					</Button>
				</ModalFooter>
			</Modal>
		</Container>
	);
};

export default AccountPage;

