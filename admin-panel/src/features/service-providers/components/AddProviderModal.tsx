import { Modal, Form, Input, Switch, Typography, message } from "antd";
import { useCreateProvider } from "../queries";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormValues {
  slug: string;
  name: string;
  isActive: boolean;
}

export default function AddProviderModal({ open, onClose }: Props) {
  const [form] = Form.useForm<FormValues>();
  const createProvider = useCreateProvider();

  function handleSubmit() {
    form.validateFields().then((values) => {
      createProvider.mutate(
        {
          slug: values.slug.trim().toLowerCase(),
          name: values.name.trim(),
          isActive: values.isActive,
        },
        {
          onSuccess: () => {
            message.success("Service provider added");
            handleClose();
          },
          onError: (err) => {
            const detail =
              (err as { response?: { data?: { error?: string; message?: string } } })?.response
                ?.data?.error ??
              (err as { response?: { data?: { error?: string; message?: string } } })?.response
                ?.data?.message ??
              (err as Error).message;
            message.error(detail || "Failed to add provider");
          },
        },
      );
    });
  }

  function handleClose() {
    form.resetFields();
    onClose();
  }

  return (
    <Modal
      title="Add Service Provider"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={createProvider.isPending}
      okText="Add Provider"
      width={520}
      destroyOnHidden
    >
      <div className="mb-3">
        <Text className="text-xs text-muted">
          Add a local provider label only. Courier API credentials are not connected yet.
        </Text>
      </div>

      <Form
        form={form}
        layout="vertical"
        className="pt-2"
        initialValues={{ isActive: true }}
      >
        <Form.Item
          name="slug"
          label="Slug"
          rules={[
            { required: true, message: "Slug is required" },
            {
              pattern: /^[a-z0-9_-]+$/,
              message: "Lowercase letters, digits, hyphens, underscores only",
            },
            { max: 64, message: "Max 64 characters" },
          ]}
        >
          <Input placeholder="e.g. local-provider" />
        </Form.Item>

        <Form.Item
          name="name"
          label="Display Name"
          rules={[{ required: true, message: "Display name is required" }]}
        >
          <Input placeholder="e.g. Local Provider" />
        </Form.Item>

        <Form.Item name="isActive" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
