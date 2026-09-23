import { useEffect, useState } from "react";
import { Button, Switch, Typography, Empty } from "antd";
import {
  Truck,
  CheckCircle2,
  XCircle,
  Plus,
  Info,
  KeyRound,
} from "lucide-react";
import ServiceProviderBadge from "@/components/common/ServiceProviderBadge";
import PageHeader from "@/components/common/PageHeader";
import ResponsiveTable, { type ResponsiveColumnsType } from "@/components/common/ResponsiveTable";
import {
  useServiceProviders,
  useUpdateProvider,
} from "./queries";
import type { ProviderListItem } from "./types";
import { resolveLogoUrl } from "./config";
import AddProviderModal from "./components/AddProviderModal";
import ProviderCredentialsExpanded from "./components/ProviderCredentialsExpanded";

const DEV_MODE_KEY = "devMode";

function useDevMode(): boolean {
  const [enabled, setEnabled] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem(DEV_MODE_KEY) === "true",
  );

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === DEV_MODE_KEY) setEnabled(e.newValue === "true");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return enabled;
}

const { Text } = Typography;

function ProviderLogo({ name, logoUrl }: { name: string; logoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const resolvedUrl = resolveLogoUrl(logoUrl);

  return (
    <div className="w-9 h-9 rounded-full bg-surface-muted border border-border-light flex items-center justify-center shrink-0 overflow-hidden">
      {resolvedUrl && !failed ? (
        <img
          src={resolvedUrl}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Truck size={16} className="text-muted" />
      )}
    </div>
  );
}


export default function ServiceProvidersPage() {
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const devMode = useDevMode();
  const { data, isLoading } = useServiceProviders(page);
  const updateProvider = useUpdateProvider();

  const providers = data?.providers ?? [];
  const pagination = data?.pagination;

  function handleStatusToggle(provider: ProviderListItem) {
    const newStatus = provider.status === "active" ? "inactive" : "active";
    updateProvider.mutate({ id: provider.id, status: newStatus });
  }

  const columns: ResponsiveColumnsType<ProviderListItem> = [
    {
      title: "Provider",
      dataIndex: "displayName",
      key: "displayName",
      render: (name: string, record) => (
        <div className="flex items-center gap-3">
          <ProviderLogo name={name} logoUrl={record.logoUrl} />
          <div className="min-w-0">
            <Text strong className="!text-foreground block text-sm leading-tight">
              {name}
            </Text>
            <ServiceProviderBadge slug={record.serviceProvider} label={record.serviceProviderDisplayName}/>
          </div>
        </div>
      ),
    },
    {
      title: "Couriers",
      key: "couriers",
      align: "center",
      width: 140,
      render: (_, record) => (
        <div className="text-center">
          <Text strong className="!text-foreground text-sm">
            {record.enabledCouriers}
          </Text>
          <Text className="text-muted text-xs"> / {record.totalCouriers}</Text>
        </div>
      ),
    },
    {
      title: "B2C Setup",
      key: "b2c",
      render: (_, record) => (
        <span className={`${record.b2c.configured ? "badge-success" : "badge-muted"} inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md`}>
          {record.b2c.configured ? "Configured" : "Not connected"}
        </span>
      ),
    },
    {
      title: "B2B Setup",
      key: "b2b",
      render: (_, record) => (
        <span className={`${record.b2b.configured ? "badge-success" : "badge-muted"} inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md`}>
          {record.b2b.configured ? "Configured" : "Not connected"}
        </span>
      ),
    },
    {
      title: "Status",
      key: "status",
      align: "center",
      width: 140,
      render: (_, record) => (
        <div className="flex items-center justify-center gap-2">
          {record.status === "active" ? (
            <span className="badge-success inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md">
              <CheckCircle2 size={14} />
              Active
            </span>
          ) : (
            <span className="badge-muted inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md">
              <XCircle size={14} />
              Inactive
            </span>
          )}
        </div>
      ),
    },
    {
      title: "Action",
      key: "toggle",
      mobileActions: true,
      align: "right",
      width: 80,
      render: (_, record) => (
        <div className="flex items-center justify-end gap-3">
          <Button
            size="small"
            type={expandedRowKeys.includes(record.id) ? "primary" : "default"}
            icon={<KeyRound size={14} />}
            onClick={() => setExpandedRowKeys((keys) => keys.includes(record.id) ? keys.filter((key) => key !== record.id) : [record.id])}
          >
            Credentials
          </Button>
          <Switch
            size="small"
            checked={record.status === "active"}
            onChange={() => handleStatusToggle(record)}
            loading={updateProvider.isPending}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Truck}
        title="Service Providers"
        subtitle="Manage live courier API providers and credentials."
        size="default"
        card={false}
        titleExtra={
          devMode ? (
            <Button
              type="primary"
              icon={<Plus size={14} />}
              onClick={() => setAddOpen(true)}
            >
              Add Provider
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-2 text-sm text-muted bg-primary-bg border border-primary/10 rounded-lg px-3.5 py-2.5">
        <Info size={15} className="text-primary shrink-0" />
        <span className="hidden sm:inline">FShip and configured courier providers are available for live shipment flows.</span>
        <span className="sm:hidden">Live courier integrations are available.</span>
      </div>

      <ResponsiveTable
        columns={columns}
        dataSource={providers}
        rowKey="id"
        loading={isLoading}
        pagination={pagination && pagination.totalPages > 1 ? {
          current: pagination.page,
          pageSize: pagination.limit,
          total: pagination.total,
          onChange: setPage,
          showSizeChanger: false,
        } : false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="text-muted">
                  No service providers found
                </span>
              }
            />
          ),
        }}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys.map(String)),
          expandedRowRender: (record) => <ProviderCredentialsExpanded provider={record} />,
          expandRowByClick: false,
        }}
      />

      {devMode && (
        <AddProviderModal open={addOpen} onClose={() => setAddOpen(false)} />
      )}
    </div>
  );
}
